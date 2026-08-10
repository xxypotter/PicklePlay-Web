"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireLogin } from "@/lib/auth/permissions";
import { canCreatePrivateSession } from "@/lib/auth/policy";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { sessions, signups } from "@/lib/db/schema";
import { requireOrganizer } from "./guards";
import { getT } from "@/lib/i18n/server";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const num = (fd: FormData, key: string) => Number(str(fd, key));

const FORMATS = ["regular", "balanced", "fixed", "custom"] as const;
type Format = (typeof FORMATS)[number];

/** Server-side caps; the form mirrors these but is not what enforces them. */
const MAX_COURTS = 4;
const PLAYERS_PER_COURT = 6;

/**
 * How many of a session's places are actually taken.
 *
 * Counts people who are confirmed *and* expected to play. Before the night
 * those are the same set, because `attended` defaults to true — the two only
 * diverge once an organizer marks a no-show, and at that moment the place
 * genuinely is free.
 *
 * Counting raw signups instead is what made the play console lie: a player who
 * never turned up kept their seat, so tapping "+ walk-in" silently filed them
 * on the waitlist and they were never scheduled.
 */
const occupiedPlaces = (sessionId: string) => sql`(
  select count(*) from ${signups}
  where session_id = ${sessionId}::uuid and state = 'in' and attended = true
)`;

export async function createSessionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireAdmin();
  const t = await getT();

  const title = str(formData, "title");
  if (!title || title.length > 80) {
    return { error: t("err.titleRequired"), field: "title" };
  }

  // The client converts the datetime-local value to a UTC ISO string before
  // submitting, because the server has no idea what timezone the phone is in.
  const startsAt = new Date(str(formData, "startsAt"));
  if (Number.isNaN(startsAt.getTime())) {
    return { error: t("err.pickDateTime"), field: "startsAtLocal" };
  }

  // "3, 4" or "Center, North" — whatever the venue actually calls them.
  const courtNames = str(formData, "courtNames")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (courtNames.length === 0) {
    return { error: t("err.nameCourt"), field: "courtNames" };
  }
  if (courtNames.length > MAX_COURTS) {
    return { error: t("err.maxCourts", { max: MAX_COURTS }), field: "courtNames" };
  }
  if (new Set(courtNames.map((c) => c.toLowerCase())).size !== courtNames.length) {
    return { error: t("err.courtsDistinct"), field: "courtNames" };
  }
  if (courtNames.some((c) => c.length > 16)) {
    return { error: t("err.courtNameLong"), field: "courtNames" };
  }

  const courtCount = courtNames.length;
  const seatCap = courtCount * PLAYERS_PER_COURT;
  const maxPlayers = num(formData, "maxPlayers");

  if (!Number.isInteger(maxPlayers) || maxPlayers < 4 || maxPlayers > seatCap) {
    return {
      error: t.plural("err.maxPlayersRange", courtCount, {
        cap: seatCap,
        courts: courtCount,
      }),
      field: "maxPlayers",
    };
  }

  const format = str(formData, "format") as Format;
  if (!FORMATS.includes(format)) return { error: t("err.pickFormat"), field: "format" };

  const db = getDb();

  const inserted = await db
    .insert(sessions)
    .values({
      title,
      location: str(formData, "location") || null,
      startsAt,
      courtNames,
      courtCount,
      maxPlayers,
      format,
      rated: formData.get("rated") !== null,
      /*
       * Checked server-side, not merely hidden in the form. The checkbox is
       * absent for everyone below super admin, but a hidden field is a
       * suggestion — anyone can post one.
       */
      isPrivate:
        formData.get("isPrivate") !== null && canCreatePrivateSession(me),
      notes: str(formData, "notes") || null,
      status: "open",
      createdBy: me.id,
    })
    .returning({ id: sessions.id });

  const sessionId = inserted[0].id;

  /*
   * Players the organizer picked up front are marked in, not merely invited.
   * For a standing group the organizer already knows who's coming, and making
   * twelve people each tap "I'm in" to confirm what's already true is friction
   * for its own sake. Anyone can still opt out themselves from the session page.
   */
  const invited = formData
    .getAll("invite")
    .map((v) => String(v))
    .filter(Boolean)
    .slice(0, 64);

  if (invited.length > 0) {
    await db.insert(signups).values(
      invited.map((playerId, i) => ({
        sessionId,
        playerId,
        // Beyond capacity they queue, exactly as a self-RSVP would.
        state: (i < maxPlayers ? "in" : "waitlist") as "in" | "waitlist",
        waitlistPos: i < maxPlayers ? null : i - maxPlayers + 1,
        addedByOrganizer: true,
      })),
    );
  }

  redirect(`/s/${sessionId}`);
}

/**
 * RSVP in or out.
 *
 * The interesting case is two people claiming the last spot at the same
 * moment. Capacity is decided by counting confirmed signups *inside* a single
 * INSERT ... SELECT, so the database resolves the race rather than a
 * read-then-write in application code that both requests would win.
 */
export async function rsvpAction(sessionId: string, going: boolean): Promise<void> {
  const t = await getT();
  const me = await requireLogin();
  const db = getDb();

  const found = await db
    .select({ id: sessions.id, maxPlayers: sessions.maxPlayers, status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const session = found[0];
  if (!session) throw new Error(t("err.sessionGone"));
  if (session.status === "closed") throw new Error(t("err.sessionClosed"));

  if (!going) {
    await db
      .delete(signups)
      .where(and(eq(signups.sessionId, sessionId), eq(signups.playerId, me.id)));
    await promoteFromWaitlist(sessionId, session.maxPlayers);
    revalidatePath(`/s/${sessionId}`);
    revalidatePath("/");
    return;
  }

  await db.execute(sql`
    insert into ${signups} (session_id, player_id, state)
    select ${sessionId}::uuid, ${me.id}::uuid,
      case when ${occupiedPlaces(sessionId)} < ${session.maxPlayers}
        then 'in'::signup_state else 'waitlist'::signup_state end
    on conflict (session_id, player_id) do nothing
  `);

  await resequenceWaitlist(sessionId);
  revalidatePath(`/s/${sessionId}`);
  revalidatePath("/");
}

/** Fill freed spots from the front of the queue, oldest signup first. */
async function promoteFromWaitlist(sessionId: string, maxPlayers: number): Promise<void> {
  await getDb().execute(sql`
    update ${signups} set state = 'in', waitlist_pos = null
    where id in (
      select id from ${signups}
      where session_id = ${sessionId}::uuid and state = 'waitlist'
      order by created_at asc
      limit greatest(0, ${maxPlayers} - ${occupiedPlaces(sessionId)})
    )
  `);
  await resequenceWaitlist(sessionId);
}

/** Keep displayed queue positions contiguous: 1, 2, 3 with no gaps. */
async function resequenceWaitlist(sessionId: string): Promise<void> {
  await getDb().execute(sql`
    update ${signups} s set waitlist_pos = ranked.pos
    from (
      select id, row_number() over (order by created_at asc) as pos
      from ${signups}
      where session_id = ${sessionId}::uuid and state = 'waitlist'
    ) ranked
    where s.id = ranked.id and s.waitlist_pos is distinct from ranked.pos
  `);
}

/**
 * Add someone to a session on their behalf.
 *
 * Two real cases: a player turns up who never RSVP'd, and an organizer wants to
 * build a roster without twelve people each logging in. Uses the same capacity
 * rule as a self-RSVP, so an admin can't silently overfill the courts.
 */
export async function addPlayerAction(sessionId: string, playerId: string): Promise<void> {
  const t = await getT();
  await requireOrganizer(sessionId);
  const db = getDb();

  const found = await db
    .select({ maxPlayers: sessions.maxPlayers })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!found[0]) throw new Error(t("err.sessionGone"));

  await db.execute(sql`
    insert into ${signups} (session_id, player_id, state, added_by_organizer)
    select ${sessionId}::uuid, ${playerId}::uuid,
      case when ${occupiedPlaces(sessionId)} < ${found[0].maxPlayers}
        then 'in'::signup_state else 'waitlist'::signup_state end,
      true
    on conflict (session_id, player_id) do nothing
  `);

  await resequenceWaitlist(sessionId);
  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
}

export async function removePlayerAction(sessionId: string, playerId: string): Promise<void> {
  await requireOrganizer(sessionId);
  const db = getDb();

  const found = await db
    .select({ maxPlayers: sessions.maxPlayers })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  await db
    .delete(signups)
    .where(and(eq(signups.sessionId, sessionId), eq(signups.playerId, playerId)));

  if (found[0]) await promoteFromWaitlist(sessionId, found[0].maxPlayers);

  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
}

/**
 * Mark someone present or absent on the night.
 *
 * Marking a no-show frees their place, so anyone waiting is pulled in straight
 * away rather than the organizer having to notice and do it by hand.
 *
 * Marking someone back in is deliberately not capped. If ten people are
 * standing on the court, refusing the tenth because the sign-up sheet said
 * nine helps nobody — the round builder already handles more players than
 * seats by rotating who sits out.
 */
export async function setAttendanceAction(
  sessionId: string,
  playerId: string,
  attended: boolean,
): Promise<void> {
  await requireOrganizer(sessionId);
  await getDb()
    .update(signups)
    .set({ attended })
    .where(and(eq(signups.sessionId, sessionId), eq(signups.playerId, playerId)));

  if (!attended) {
    const found = await getDb()
      .select({ maxPlayers: sessions.maxPlayers })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (found[0]) await promoteFromWaitlist(sessionId, found[0].maxPlayers);
  }

  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
}


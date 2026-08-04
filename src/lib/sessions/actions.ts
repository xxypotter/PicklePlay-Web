"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireLogin } from "@/lib/auth/permissions";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { sessions, signups } from "@/lib/db/schema";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const num = (fd: FormData, key: string) => Number(str(fd, key));

const FORMATS = ["regular", "balanced", "fixed", "custom"] as const;
type Format = (typeof FORMATS)[number];

/** Server-side caps; the form mirrors these but is not what enforces them. */
const MAX_COURTS = 4;
const PLAYERS_PER_COURT = 6;

export async function createSessionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireAdmin();

  const title = str(formData, "title");
  if (!title || title.length > 80) {
    return { error: "Give the session a title (80 characters or fewer).", field: "title" };
  }

  // The client converts the datetime-local value to a UTC ISO string before
  // submitting, because the server has no idea what timezone the phone is in.
  const startsAt = new Date(str(formData, "startsAt"));
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Pick a date and time.", field: "startsAtLocal" };
  }

  // "3, 4" or "Center, North" — whatever the venue actually calls them.
  const courtNames = str(formData, "courtNames")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (courtNames.length === 0) {
    return { error: "Name at least one court, e.g. 3, 4", field: "courtNames" };
  }
  if (courtNames.length > MAX_COURTS) {
    return { error: `${MAX_COURTS} courts maximum.`, field: "courtNames" };
  }
  if (new Set(courtNames.map((c) => c.toLowerCase())).size !== courtNames.length) {
    return { error: "Each court needs a different name.", field: "courtNames" };
  }
  if (courtNames.some((c) => c.length > 16)) {
    return { error: "Court names must be 16 characters or fewer.", field: "courtNames" };
  }

  const courtCount = courtNames.length;
  const seatCap = courtCount * PLAYERS_PER_COURT;
  const maxPlayers = num(formData, "maxPlayers");

  if (!Number.isInteger(maxPlayers) || maxPlayers < 4 || maxPlayers > seatCap) {
    return {
      error: `Max players must be between 4 and ${seatCap} for ${courtCount} court${
        courtCount === 1 ? "" : "s"
      }.`,
      field: "maxPlayers",
    };
  }

  const format = str(formData, "format") as Format;
  if (!FORMATS.includes(format)) return { error: "Pick a format.", field: "format" };

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
  const me = await requireLogin();
  const db = getDb();

  const found = await db
    .select({ id: sessions.id, maxPlayers: sessions.maxPlayers, status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const session = found[0];
  if (!session) throw new Error("That session no longer exists.");
  if (session.status === "closed") throw new Error("That session is closed.");

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
      case when (
        select count(*) from ${signups}
        where session_id = ${sessionId}::uuid and state = 'in'
      ) < ${session.maxPlayers} then 'in'::signup_state else 'waitlist'::signup_state end
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
      limit greatest(0, ${maxPlayers} - (
        select count(*) from ${signups}
        where session_id = ${sessionId}::uuid and state = 'in'
      ))
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
  await requireAdmin();
  const db = getDb();

  const found = await db
    .select({ maxPlayers: sessions.maxPlayers })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!found[0]) throw new Error("That session no longer exists.");

  await db.execute(sql`
    insert into ${signups} (session_id, player_id, state, added_by_organizer)
    select ${sessionId}::uuid, ${playerId}::uuid,
      case when (
        select count(*) from ${signups}
        where session_id = ${sessionId}::uuid and state = 'in'
      ) < ${found[0].maxPlayers} then 'in'::signup_state else 'waitlist'::signup_state end,
      true
    on conflict (session_id, player_id) do nothing
  `);

  await resequenceWaitlist(sessionId);
  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
}

export async function removePlayerAction(sessionId: string, playerId: string): Promise<void> {
  await requireAdmin();
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

export async function setAttendanceAction(
  sessionId: string,
  playerId: string,
  attended: boolean,
): Promise<void> {
  await requireAdmin();
  await getDb()
    .update(signups)
    .set({ attended })
    .where(and(eq(signups.sessionId, sessionId), eq(signups.playerId, playerId)));
  revalidatePath(`/s/${sessionId}`);
}

export async function setSessionStatusAction(
  sessionId: string,
  status: "open" | "live" | "closed",
): Promise<void> {
  await requireAdmin();
  await getDb().update(sessions).set({ status }).where(eq(sessions.id, sessionId));
  revalidatePath(`/s/${sessionId}`);
  revalidatePath("/");
}

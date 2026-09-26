"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireLogin } from "@/lib/auth/permissions";
import { canSeeSession, canCreatePrivateSession } from "@/lib/auth/policy";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { rounds, sessions, signups } from "@/lib/db/schema";
import { requireOrganizer } from "./guards";
import { getT } from "@/lib/i18n/server";

import { inTransaction, lockSession, type Transaction } from "@/lib/db/transaction";
import { requireMutableRoster } from "@/lib/mlp/guards";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const num = (fd: FormData, key: string) => Number(str(fd, key));

const FORMATS = ["regular", "balanced", "gender", "fixed", "custom", "mlp"] as const;
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
  if (format === "mlp" && (courtCount !== 4 || maxPlayers !== 24)) return { error: t("mlp.error.setup") };

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
 * moment. The session advisory lock serializes roster writes, then capacity is
 * counted inside the transaction so concurrent requests cannot both claim it.
 */
export async function rsvpAction(sessionId: string, going: boolean): Promise<void> {
  const me=await requireLogin();
  await inTransaction(async db=>{
    await lockSession(db,sessionId);
    const session=await requireMutableRoster(db,sessionId);
    const mine=await db.select().from(signups).where(and(eq(signups.sessionId,sessionId),eq(signups.playerId,me.id)));
    if(!canSeeSession(me,session,mine.length>0)) throw new Error((await getT())("err.sessionGone"));
    if(!going) {
      await detach(db,sessionId,me.id);
      await db.delete(signups).where(and(eq(signups.sessionId,sessionId),eq(signups.playerId,me.id)));
      await promote(db,sessionId,session.maxPlayers);
    } else {
      await db.execute(sql`insert into ${signups} (session_id,player_id,state)
        select ${sessionId}::uuid,${me.id}::uuid,
        case when ${occupiedPlaces(sessionId)} < ${session.maxPlayers} then 'in'::signup_state else 'waitlist'::signup_state end
        on conflict (session_id,player_id) do nothing`);
    }
    await resequence(db,sessionId);
  });
  refreshRoster(sessionId);
}

async function promote(db:Transaction,id:string,cap:number) {
  await db.execute(sql`update ${signups} set state='in',waitlist_pos=null where id in
    (select id from ${signups} where session_id=${id}::uuid and state='waitlist' order by created_at,id
    limit greatest(0,${cap}-${occupiedPlaces(id)}))`);
}
async function resequence(db:Transaction,id:string) {
  await db.execute(sql`update ${signups} s set waitlist_pos=ranked.pos from
    (select id,row_number() over(order by created_at,id) as pos from ${signups}
    where session_id=${id}::uuid and state='waitlist') ranked where s.id=ranked.id`);
}
function refreshRoster(id:string) {
  revalidatePath(`/s/${id}`); revalidatePath(`/s/${id}/play`); revalidatePath("/");
}
async function detach(db:Transaction,id:string,playerId:string) {
  await db.execute(sql`update ${signups} set partner_id=null where session_id=${id}::uuid
    and (player_id=${playerId}::uuid or partner_id=${playerId}::uuid)`);
}

export async function addPlayerAction(sessionId:string,playerId:string):Promise<void> {
  await requireOrganizer(sessionId);
  await inTransaction(async db=>{
    await lockSession(db,sessionId);
    const session=await requireMutableRoster(db,sessionId);
    if(session.format==="mlp") {
      const [{n}]=await db.select({n:sql<number>`count(*)::int`}).from(signups).where(and(
        eq(signups.sessionId,sessionId),eq(signups.state,"in"),eq(signups.attended,true)));
      const [existing]=await db.select().from(signups).where(and(eq(signups.sessionId,sessionId),eq(signups.playerId,playerId)));
      if(n>=24 && !(existing?.state==="in" && existing.attended)) throw new Error((await getT())("mlp.error.teams"));
    }
    await db.execute(sql`insert into ${signups} (session_id,player_id,state,waitlist_pos,added_by_organizer,attended)
      values (${sessionId}::uuid,${playerId}::uuid,'in',null,true,true)
      on conflict (session_id,player_id) do update set state='in',waitlist_pos=null,attended=true,added_by_organizer=true`);
    await db.execute(sql`update ${sessions} set max_players=greatest(max_players,${occupiedPlaces(sessionId)}) where id=${sessionId}::uuid`);
    await resequence(db,sessionId);
  });
  refreshRoster(sessionId);
}
export async function removePlayerAction(sessionId:string,playerId:string):Promise<void> {
  await requireOrganizer(sessionId);
  await inTransaction(async db=>{
    await lockSession(db,sessionId);
    const session=await requireMutableRoster(db,sessionId);
    await detach(db,sessionId,playerId);
    await db.delete(signups).where(and(eq(signups.sessionId,sessionId),eq(signups.playerId,playerId)));
    await promote(db,sessionId,session.maxPlayers); await resequence(db,sessionId);
  });
  refreshRoster(sessionId);
}
export async function setAttendanceAction(sessionId:string,playerId:string,attended:boolean):Promise<void> {
  await requireOrganizer(sessionId);
  if(typeof attended!=="boolean") throw new Error("Invalid attendance");
  await inTransaction(async db=>{
    await lockSession(db,sessionId);
    const session=await requireMutableRoster(db,sessionId);
    if(attended && session.format==="mlp") {
      const [{n}]=await db.select({n:sql<number>`count(*)::int`}).from(signups).where(and(
        eq(signups.sessionId,sessionId),eq(signups.state,"in"),eq(signups.attended,true)));
      const [existing]=await db.select().from(signups).where(and(eq(signups.sessionId,sessionId),eq(signups.playerId,playerId)));
      if(n>=24 && !existing?.attended) throw new Error((await getT())("mlp.error.teams"));
    }
    await db.update(signups).set({attended}).where(and(eq(signups.sessionId,sessionId),eq(signups.playerId,playerId)));
    if(!attended) { await promote(db,sessionId,session.maxPlayers); await resequence(db,sessionId); }
  });
  refreshRoster(sessionId);
}

/** Live edits affect newly generated games; already drawn games keep their players. */
export async function setPartnerAction(sessionId:string,playerId:string,partnerId:string|null):Promise<void> {
  await requireOrganizer(sessionId);
  const t=await getT();
  await inTransaction(async db=>{
    await lockSession(db,sessionId);
    const session=await requireMutableRoster(db,sessionId);
    if(session.format!=="fixed") throw new Error(t("err.pairsLocked"));
    const bracket=await db.select().from(rounds).where(and(eq(rounds.sessionId,sessionId),sql`${rounds.stage} <> 'robin'`)).limit(1);
    if(bracket.length) throw new Error(t("err.rebuildAfterMedal"));
    const roster=await db.select().from(signups).where(and(eq(signups.sessionId,sessionId),eq(signups.state,"in"),eq(signups.attended,true)));
    if(!roster.some(p=>p.playerId===playerId) || (partnerId && (partnerId===playerId || !roster.some(p=>p.playerId===partnerId)))) {
      throw new Error(t("err.medalNotAPair"));
    }
    await detach(db,sessionId,playerId);
    if(partnerId) {
      await detach(db,sessionId,partnerId);
      await db.update(signups).set({partnerId}).where(and(eq(signups.sessionId,sessionId),eq(signups.playerId,playerId)));
      await db.update(signups).set({partnerId:playerId}).where(and(eq(signups.sessionId,sessionId),eq(signups.playerId,partnerId)));
    }
  });
  refreshRoster(sessionId);
}

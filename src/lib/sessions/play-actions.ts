"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Actor } from "@/lib/auth/policy";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { auditLog, matches, rounds, sessions } from "@/lib/db/schema";
import { createNextRound } from "@/lib/matchmaking/service";
import { requireOrganizer, requireScorer } from "./guards";
import { getT } from "@/lib/i18n/server";
import { recomputeAll } from "@/lib/rating/service";

/**
 * Begin play.
 *
 * Explicit, rather than inferred from the first round being generated. Building
 * a schedule ahead of time used to flip a session to "Playing" days before
 * anyone turned up, and it silently locked nothing — so details stayed editable
 * while the night was supposedly underway.
 *
 * Starting is the line: before it the details can change, after it they can't.
 */
export async function startSessionAction(sessionId: string): Promise<void> {
  await requireOrganizer(sessionId);

  await getDb()
    .update(sessions)
    .set({ status: "live" })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, "open")));

  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
  revalidatePath("/");
}

/**
 * Undo a start — only while nothing has been played.
 *
 * Tapping Start a day early shouldn't be permanent, but once a round exists the
 * session has really begun and reopening it would put edits back in reach of a
 * night in progress.
 */
export async function reopenSessionAction(sessionId: string): Promise<void> {
  const t = await getT();
  await requireOrganizer(sessionId);
  const db = getDb();

  const existing = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId))
    .limit(1);

  if (existing.length > 0) {
    throw new Error(t("err.matchesExist"));
  }

  await db
    .update(sessions)
    .set({ status: "open" })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, "live")));

  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
  revalidatePath("/");
}

/** Matches only exist once play has started. */
async function requireLive(sessionId: string): Promise<void> {
  const t = await getT();
  const found = await getDb()
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (found[0]?.status !== "live") {
    throw new Error(t("err.startFirst"));
  }
}

export async function generateRoundAction(sessionId: string): Promise<void> {
  await requireOrganizer(sessionId);
  await requireLive(sessionId);
  await createNextRound(sessionId);

  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
}

/** Hard cap; beyond this a "session" is really several nights. */
const MAX_ROUNDS = 20;

/**
 * Build the whole night's schedule in one go.
 *
 * Generating round by round meant the organizer had to be on their phone
 * between every game, and nobody could see who they were playing later. Rounds
 * are still produced sequentially — each one reads the history the previous
 * ones created, so partner and sit-out fairness still hold across the set.
 */
export async function generateAllRoundsAction(
  sessionId: string,
  roundCount: number,
): Promise<void> {
  await requireOrganizer(sessionId);
  await requireLive(sessionId);

  const wanted = Math.max(1, Math.min(MAX_ROUNDS, Math.floor(roundCount)));
  for (let i = 0; i < wanted; i++) {
    await createNextRound(sessionId);
  }

  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
}

/**
 * End a session.
 *
 * A named action rather than a generic status setter, so the intent is explicit
 * at the call site and the audit log records who ended a night and when —
 * useful when someone asks why a match can no longer be scored.
 */
export async function endSessionAction(sessionId: string): Promise<void> {
  const { me } = await requireOrganizer(sessionId);
  const db = getDb();

  await db
    .update(sessions)
    .set({ status: "closed" })
    .where(and(eq(sessions.id, sessionId), ne(sessions.status, "closed")));

  await db.insert(auditLog).values({
    actorId: me.id,
    action: "session.end",
    targetType: "session",
    targetId: sessionId,
  });

  revalidatePath(`/s/${sessionId}`);
  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath("/");
}

/**
 * Delete a session and everything under it.
 *
 * An admin may delete sessions they created; the super admin may delete any.
 * Scoping it this way means one organizer can't wipe another's night, while the
 * owner still has a way to clean up.
 *
 * Matches cascade, so any ratings they moved have to be rebuilt — the recompute
 * puts every player back where they'd be if the session had never happened.
 */
export async function deleteSessionAction(sessionId: string): Promise<void> {
  const { me } = await requireOrganizer(sessionId);
  const db = getDb();

  // Ownership is already settled by requireOrganizer; all we still need is
  // whether deleting this session has to roll ratings back.
  const found = await db
    .select({ rated: sessions.rated })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const session = found[0];
  if (!session) return;

  await db.delete(sessions).where(eq(sessions.id, sessionId));

  await db.insert(auditLog).values({
    actorId: me.id,
    action: "session.delete",
    targetType: "session",
    targetId: sessionId,
  });

  if (session.rated) await recomputeAll();

  revalidatePath("/sessions");
  revalidatePath("/leaderboard");
  revalidatePath("/");
  redirect("/sessions");
}

/** Throw away a round that hasn't been played — regenerating is one tap. */
export async function discardRoundAction(sessionId: string, roundId: string): Promise<void> {
  const t = await getT();
  await requireOrganizer(sessionId);
  const db = getDb();

  const played = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.roundId, roundId), eq(matches.status, "completed")))
    .limit(1);

  if (played.length > 0) {
    throw new Error(t("err.roundScored"));
  }

  await db.delete(matches).where(eq(matches.roundId, roundId));
  await db.delete(rounds).where(eq(rounds.id, roundId));

  revalidatePath(`/s/${sessionId}/play`);
}

/**
 * Record a score.
 *
 * Anyone who played in the match can submit it, with no confirmation step —
 * pending-confirmation queues just rot in a small trusted group. Admins can fix
 * anything afterwards, and because ratings are always recomputed from the match
 * history, a correction is never more expensive than the original entry.
 */
export async function saveScoreAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getT();
  const db = getDb();

  const matchId = String(formData.get("matchId") ?? "");
  const scoreA = Number(String(formData.get("scoreA") ?? ""));
  const scoreB = Number(String(formData.get("scoreB") ?? ""));

  // Who may score depends on the match *and* the state of its session, so the
  // guard resolves both. Returned as a form error rather than a throw, since
  // this one is reachable from a form a player is looking at.
  let me: Actor;
  let sessionId: string | null;
  try {
    ({ me, sessionId } = await requireScorer(matchId));
  } catch (error) {
    return { error: error instanceof Error ? error.message : t("err.notAuthorized") };
  }

  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    return { error: t("schedule.error.whole") };
  }
  if (scoreA === scoreB) return { error: t("schedule.error.tie") };
  if (scoreA > 99 || scoreB > 99) return { error: t("schedule.error.range") };

  await db
    .update(matches)
    .set({ scoreA, scoreB, status: "completed", enteredBy: me.id, editedAt: new Date() })
    .where(eq(matches.id, matchId));

  await recomputeIfRated(sessionId);

  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
  revalidatePath("/");
  return {};
}

export async function voidMatchAction(matchId: string): Promise<void> {
  // Participation doesn't grant a void — see requireScorer.
  const { sessionId } = await requireScorer(matchId, { allowParticipant: false });
  const db = getDb();

  // Voided rather than deleted, so the history stays auditable (§7).
  await db.update(matches).set({ status: "void", editedAt: new Date() }).where(eq(matches.id, matchId));

  if (sessionId) {
    await recomputeIfRated(sessionId);
    revalidatePath(`/s/${sessionId}/play`);
    revalidatePath(`/s/${sessionId}`);
  }
  revalidatePath("/");
}

/** Unrated sessions still record matches; they just don't move anyone's number. */
async function recomputeIfRated(sessionId: string | null): Promise<void> {
  if (!sessionId) return;

  const found = await getDb()
    .select({ rated: sessions.rated })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (found[0]?.rated) await recomputeAll();
}

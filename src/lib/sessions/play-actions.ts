"use server";

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Actor } from "@/lib/auth/policy";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { auditLog, matches, rounds, sessions } from "@/lib/db/schema";
import { createAllRounds, createNextRound, getAttending } from "@/lib/matchmaking/service";
import { requireLogin } from "@/lib/auth/permissions";
import { canVoidMatch, PermissionError } from "@/lib/auth/policy";
import { finals, semiFinals, teamStandings, type PlayedMatch } from "./medal";
import { checkManualRound } from "./manual-round";
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
  await createAllRounds(sessionId, wanted);

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
 * Throw away the unplayed schedule and build a new one.
 *
 * The case this exists for: ten people, all the matchups made, and an eleventh
 * walks in. Until now that was a dead end — the draw was fixed, and the only
 * way out was deleting the session and starting the night again.
 *
 * **Rounds that have been played are never touched.** A round is settled once
 * any of its matches has a score or has been voided, and settled rounds are
 * kept exactly as they are; only rounds nobody has played yet are discarded and
 * replaced. Which is the whole reason this is safe to offer mid-session rather
 * than only before the first serve.
 *
 * Two paths, because they are genuinely different problems:
 *
 * - **Nothing played yet** — the common case, an arrival at the start of the
 *   night. Everything is discarded and the whole-session planner runs from a
 *   clean slate, so a regular or gender-balanced draw keeps its promise that
 *   you partner everyone once.
 * - **Some rounds played** — the planner cannot help; it solves a whole session
 *   and this one is half spent. Falls back to generating a round at a time,
 *   which reads the history the played rounds created, so partner and sit-out
 *   fairness carry across the join.
 */
export async function rebuildMatchupsAction(
  sessionId: string,
  roundCount: number,
): Promise<void> {
  await requireOrganizer(sessionId);
  await requireLive(sessionId);

  const db = getDb();
  const wanted = Math.max(1, Math.min(MAX_ROUNDS, Math.floor(roundCount)));

  // Once the bracket is drawn the schedule is finished. New round-robin rounds
  // would be appended *after* the final, which is not a thing that can happen.
  const bracket = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.sessionId, sessionId), ne(rounds.stage, "robin")))
    .limit(1);

  if (bracket.length > 0) throw new Error((await getT())("err.rebuildAfterMedal"));

  const roundRows = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId))
    .orderBy(asc(rounds.index));

  // Settled means "has a result of any kind", so a voided match protects its
  // round too — voiding records something that happened, it is not an eraser.
  const settledRows = roundRows.length
    ? await db
        .select({ roundId: matches.roundId })
        .from(matches)
        .where(and(eq(matches.sessionId, sessionId), ne(matches.status, "scheduled")))
    : [];

  const settled = new Set(settledRows.map((r) => r.roundId));
  const doomed = roundRows.filter((r) => !settled.has(r.id)).map((r) => r.id);

  if (doomed.length > 0) {
    // Matches first: `matches.round_id` is ON DELETE SET NULL, so dropping the
    // round alone would leave its matches orphaned and still countable.
    await db.delete(matches).where(inArray(matches.roundId, doomed));
    await db.delete(rounds).where(inArray(rounds.id, doomed));
  }

  if (settled.size === 0) {
    await createAllRounds(sessionId, wanted);
  } else {
    for (let i = 0; i < wanted; i++) await createNextRound(sessionId);
  }

  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
}

/** Scored matches of one stage, in bracket order. */
async function playedMatches(
  sessionId: string,
  stage: "robin" | "semifinal",
): Promise<PlayedMatch[]> {
  const rows = await getDb()
    .select({
      a1: matches.a1,
      a2: matches.a2,
      b1: matches.b1,
      b2: matches.b2,
      scoreA: matches.scoreA,
      scoreB: matches.scoreB,
    })
    .from(matches)
    .innerJoin(rounds, eq(rounds.id, matches.roundId))
    .where(
      and(
        eq(matches.sessionId, sessionId),
        eq(matches.status, "completed"),
        eq(rounds.stage, stage),
      ),
    )
    .orderBy(asc(rounds.index), asc(matches.courtNo));

  return rows
    .filter((r) => r.scoreA !== null && r.scoreB !== null)
    .map((r) => ({
      a1: r.a1,
      a2: r.a2,
      b1: r.b1,
      b2: r.b2,
      scoreA: r.scoreA as number,
      scoreB: r.scoreB as number,
    }));
}

/** Append a round whose pairings are already decided. */
async function appendRound(
  sessionId: string,
  stage: "robin" | "semifinal" | "final",
  pairings: Array<[string, string, string, string]>,
): Promise<void> {
  const db = getDb();

  const last = await db
    .select({ index: rounds.index })
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId))
    .orderBy(desc(rounds.index))
    .limit(1);

  const inserted = await db
    .insert(rounds)
    .values({ sessionId, index: (last[0]?.index ?? 0) + 1, state: "active", stage })
    .returning({ id: rounds.id });

  await db.insert(matches).values(
    pairings.map(([a1, a2, b1, b2], court) => ({
      sessionId,
      roundId: inserted[0].id,
      courtNo: court + 1,
      a1,
      a2,
      b1,
      b2,
      status: "scheduled" as const,
    })),
  );

  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath(`/s/${sessionId}`);
}

/**
 * A round the organizer built by hand.
 *
 * "Add another round" draws at random, which is right almost always and wrong
 * exactly when somebody has a plan: after six rounds of fixed partners, put the
 * first team against the second and the third against the fourth. That is a
 * round robin ending in a placement round, and no amount of shuffling produces
 * it.
 *
 * Available in **every** format and at any point in a live session — before the
 * scheduled rounds are finished as much as after. It does not replace the random
 * draw or the fixed-partner medal round (§4.7); it sits alongside both.
 *
 * Recorded as an ordinary `robin` round, because that is what it is: four people
 * on a court whose result counts exactly like any other. In particular it stays
 * eligible to seed a medal round, and does not itself block one.
 *
 * **Everything here is untrusted.** The client says *which* players, and nothing
 * else — the roster it is checked against is re-read from the database under the
 * caller's own session, never taken from the request.
 */
export async function createManualRoundAction(
  sessionId: string,
  pairings: Array<[string, string, string, string]>,
): Promise<void> {
  const t = await getT();
  await requireOrganizer(sessionId);
  await requireLive(sessionId);

  const db = getDb();

  const found = await db
    .select({ courtCount: sessions.courtCount })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!found[0]) throw new Error(t("err.sessionGone"));

  /*
   * The roster comes from the database, never from the request. A well-formed
   * list of four ids can still name somebody who never signed up, was marked
   * out, or belongs to another session entirely — which is precisely what a
   * shape check cannot catch.
   */
  const present = new Set((await getAttending(sessionId)).map((p) => p.id));
  const checked = checkManualRound(pairings, found[0].courtCount, present);
  if (!checked.ok) throw new Error(t(checked.error, checked.values));

  await appendRound(sessionId, "robin", checked.pairings);
}

/**
 * Semi-finals: first seed against fourth, second against third.
 *
 * Fixed partners only. It is the one format where a team survives the whole
 * night, and a bracket between teams that dissolve after every round would mean
 * nothing.
 *
 * Refuses while any match is still unscored. Seeding off a partial table would
 * rank teams on how many games they had got round to playing.
 */
export async function addMedalRoundAction(sessionId: string): Promise<void> {
  const t = await getT();
  await requireOrganizer(sessionId);
  await requireLive(sessionId);
  const db = getDb();

  const found = await db
    .select({ format: sessions.format })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (found[0]?.format !== "fixed") throw new Error(t("err.medalFixedOnly"));

  const unscored = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.sessionId, sessionId), eq(matches.status, "scheduled")))
    .limit(1);

  if (unscored.length > 0) throw new Error(t("err.medalNeedsAllScores"));

  const existing = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.sessionId, sessionId), ne(rounds.stage, "robin")))
    .limit(1);

  if (existing.length > 0) throw new Error(t("err.medalExists"));

  const bracket = semiFinals(teamStandings(await playedMatches(sessionId, "robin")));
  if (!bracket) throw new Error(t("err.medalNeedsFourTeams"));

  await appendRound(sessionId, "semifinal", bracket);
}

/**
 * The finals: semi-final winners for gold, semi-final losers for bronze.
 *
 * Separate from the semi-finals because it cannot be known until those are
 * played, which is also why the medal round is two rounds and not one bracket
 * generated in a single go.
 */
export async function addFinalsAction(sessionId: string): Promise<void> {
  const t = await getT();
  await requireOrganizer(sessionId);
  await requireLive(sessionId);
  const db = getDb();

  const already = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.sessionId, sessionId), eq(rounds.stage, "final")))
    .limit(1);

  if (already.length > 0) throw new Error(t("err.finalsExist"));

  const semis = await playedMatches(sessionId, "semifinal");
  if (semis.length !== 2) throw new Error(t("err.finalsNeedSemis"));

  await appendRound(sessionId, "final", finals([semis[0], semis[1]]));
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

/**
 * Take a match out of the record, or put it back.
 *
 * One function for both directions because they are the same decision made
 * twice, and splitting them is how the two ends up with different permissions.
 *
 * Nothing is deleted: the score stays on the row and only `status` moves, so a
 * void is always reversible and the history stays auditable (§7). The recompute
 * skips anything that isn't `completed`, which is what actually removes it from
 * everyone's rating.
 */
async function setMatchVoided(matchId: string, voided: boolean): Promise<void> {
  const t = await getT();
  const me = await requireLogin();
  if (!canVoidMatch(me)) throw new PermissionError(t("err.voidNeedsOwner"));

  const db = getDb();
  const found = await db
    .select({ sessionId: matches.sessionId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!found[0]) throw new Error(t("err.matchGone"));

  await db
    .update(matches)
    .set({ status: voided ? "void" : "completed", editedAt: new Date() })
    .where(eq(matches.id, matchId));

  await db.insert(auditLog).values({
    actorId: me.id,
    action: voided ? "match.void" : "match.restore",
    targetType: "match",
    targetId: matchId,
  });

  const sessionId = found[0].sessionId;
  if (sessionId) {
    await recomputeIfRated(sessionId);
    revalidatePath(`/s/${sessionId}/play`);
    revalidatePath(`/s/${sessionId}`);
  }
  revalidatePath("/");
}

export async function voidMatchAction(matchId: string): Promise<void> {
  await setMatchVoided(matchId, true);
}

/** Put a voided match back into the record, score and all. */
export async function restoreMatchAction(matchId: string): Promise<void> {
  await setMatchVoided(matchId, false);
}

/** Unrated sessions still record matches; they just don't move anyone's number. */
async function recomputeIfRated(sessionId: string | null): Promise<void> {
  if (!sessionId) return;

  const found = await getDb()
    .select({ rated: sessions.rated })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!found[0]?.rated) return;

  await recomputeAll();

  /*
   * A recompute rebuilds *every* player's rating, so every screen that shows
   * one is now stale — not just the session it came from.
   *
   * Tied to the recompute rather than listed at each call site: saving a score
   * used to refresh the session page and leave the rankings showing last
   * night's numbers until somebody ended the session. Anything that rebuilds
   * ratings has to invalidate the same set, and the only way to keep that true
   * is for it to be one thing.
   */
  revalidatePath("/leaderboard");
  revalidatePath("/p/[username]", "page");
  revalidatePath("/p/[username]/record", "page");
  revalidatePath("/me");
  revalidatePath("/admin");
}

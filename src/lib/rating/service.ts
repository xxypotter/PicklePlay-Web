/**
 * Bridges the pure rating engine to the database — SPEC.md §5.6.
 *
 * Reads the two source-of-truth tables, replays them through the engine, and
 * rewrites the derived caches. Anything that changes history (a score edit, a
 * void, a re-seed, a new registration) should call recomputeAll afterward.
 */
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { inTransaction, type Transaction } from "@/lib/db/transaction";
import { matches, playerStats, ratingEvents, ratingSeeds, sessions } from "@/lib/db/schema";
import { recompute, type TimelineEvent } from "./engine";

/** Keep individual insert statements within driver parameter/payload limits. */
const CHUNK = 500;

function chunked<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

export interface RecomputeSummary {
  players: number;
  matches: number;
  seeds: number;
}

export async function recomputeAll(): Promise<RecomputeSummary> {
  return inTransaction(async (db) => {
    // Acquire BEFORE reading history, so a waiting replay cannot publish an
    // older snapshot after a newer replay. READ COMMITTED sees fresh rows once
    // this lock is acquired. Both caches become visible together at commit.
    await db.execute(sql`select pg_advisory_xact_lock(72417001)`);
    return recomputeInto(db);
  });
}

async function recomputeInto(db: Transaction): Promise<RecomputeSummary> {

  const seedRows = await db.select().from(ratingSeeds).orderBy(asc(ratingSeeds.effectiveAt));

  // Matches from an unrated session are recorded but must not move anyone's
  // number. A match with no session at all (a one-off logged by hand) counts.
  const matchRows = await db
    .select({
      id: matches.id,
      playedAt: matches.playedAt,
      a1: matches.a1,
      a2: matches.a2,
      b1: matches.b1,
      b2: matches.b2,
      scoreA: matches.scoreA,
      scoreB: matches.scoreB,
    })
    .from(matches)
    .leftJoin(sessions, eq(sessions.id, matches.sessionId))
    .where(
      and(
        eq(matches.status, "completed"),
        or(isNull(matches.sessionId), eq(sessions.rated, true)),
      ),
    )
    .orderBy(asc(matches.playedAt));

  const events: TimelineEvent[] = [];

  // Seeds arrive in date order, so the first one seen for a player is their
  // signup seed and everything after it is a monthly re-seed (§5.8).
  const seen = new Set<string>();
  for (const s of seedRows) {
    const isInitial = !seen.has(s.playerId);
    seen.add(s.playerId);
    events.push({
      kind: "seed",
      at: s.effectiveAt,
      playerId: s.playerId,
      rating: s.rating,
      declaredReliability: s.declaredReliability,
      isInitial,
      /*
       * Which door it came through, not whose id is on it.
       *
       * `createdBy === playerId` looks equivalent and isn't: the super admin
       * adjusting his own rating through the admin panel sets both, and that
       * would be read as a self-override and wipe his reliability. The admin
       * panel is the vouching path whoever walks through it; `source` is the
       * only field that records which one was used.
       */
      selfInitiated: s.source !== "admin",
    });
  }

  for (const m of matchRows) {
    if (m.scoreA === null || m.scoreB === null) continue;
    events.push({
      kind: "match",
      at: m.playedAt,
      matchId: m.id,
      teamA: [m.a1, m.a2],
      teamB: [m.b1, m.b2],
      scoreA: m.scoreA,
      scoreB: m.scoreB,
    });
  }

  const result = recompute(events);

  // In one transaction: readers retain the previous complete caches until
  // commit. A failure rolls back both instead of exposing an empty leaderboard.
  await db.delete(ratingEvents);
  for (const batch of chunked(result.changes)) {
    await db.insert(ratingEvents).values(
      batch.map((c) => ({
        matchId: c.matchId,
        playerId: c.playerId,
        ratingBefore: c.ratingBefore,
        ratingAfter: c.ratingAfter,
        delta: c.delta,
        k: c.k,
        surprise: c.surprise,
        reliabilityAtTime: c.reliabilityAtTime,
      })),
    );
  }

  const stats = [...result.players.values()].map((p) => ({
    playerId: p.playerId,
    rating: p.rating,
    peakRating: p.peakRating,
    reliability: p.reliability,
    halfLife: p.halfLife,
    localMatches: p.localMatches,
    wins: p.wins,
    losses: p.losses,
    pointsFor: p.pointsFor,
    pointsAgainst: p.pointsAgainst,
    streak: p.streak,
    provisional: p.provisional,
    selfDeclared: p.selfDeclared,
    lastPlayedAt: p.lastPlayedAt,
    recomputedAt: new Date(),
  }));

  await db.delete(playerStats);
  for (const batch of chunked(stats)) {
    await db.insert(playerStats).values(batch);
  }

  return { players: stats.length, matches: matchRows.length, seeds: seedRows.length };
}

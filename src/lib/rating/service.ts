/**
 * Bridges the pure rating engine to the database — SPEC.md §5.6.
 *
 * Reads the two source-of-truth tables, replays them through the engine, and
 * rewrites the derived caches. Anything that changes history (a score edit, a
 * void, a re-seed, a new registration) should call recomputeAll afterward.
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { matches, playerStats, ratingEvents, ratingSeeds } from "@/lib/db/schema";
import { recompute, type TimelineEvent } from "./engine";

/** neon-http sends one HTTP request per statement, so keep inserts chunked. */
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
  const db = getDb();

  const seedRows = await db.select().from(ratingSeeds).orderBy(asc(ratingSeeds.effectiveAt));
  const matchRows = await db
    .select()
    .from(matches)
    .where(eq(matches.status, "completed"))
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

  // Both of these are caches (§7). They are rebuilt wholesale rather than
  // patched, so a partial failure here is self-healing: the next recompute
  // produces the correct state regardless of what this one left behind.
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

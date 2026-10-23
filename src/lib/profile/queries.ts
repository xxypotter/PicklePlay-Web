import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { matches } from "@/lib/db/schema";
import type { PlayedMatch } from "./record";

/**
 * Every scored game a player has played here, rated or casual.
 *
 * "Played" and "won" mean the same thing on every screen from v2.0: a game
 * that was played and scored counts, whether or not it moved a rating. Only
 * the rating itself ignores casual nights. The engine's own win/loss tallies
 * cover rated games alone, which is why nothing displays them any more.
 */
export async function completedMatchesOf(playerId: string): Promise<PlayedMatch[]> {
  return getDb()
    .select({
      matchId: matches.id,
      playedAt: matches.playedAt,
      a1: matches.a1,
      a2: matches.a2,
      b1: matches.b1,
      b2: matches.b2,
      scoreA: matches.scoreA,
      scoreB: matches.scoreB,
    })
    .from(matches)
    .where(and(eq(matches.status, "completed"), or(
      eq(matches.a1, playerId), eq(matches.a2, playerId), eq(matches.b1, playerId), eq(matches.b2, playerId),
    )));
}

export interface Career {
  played: number;
  won: number;
}

/** Played and won for many players at once — one query for a whole table. */
export async function careerOf(playerIds: readonly string[]): Promise<Map<string, Career>> {
  if (playerIds.length === 0) return new Map();
  const rows = await getDb().execute<{ pid: string; played: number; won: number }>(sql`
    with sides as (
      select a1 as pid, score_a as pf, score_b as pa from ${matches} where status = 'completed'
      union all select a2, score_a, score_b from ${matches} where status = 'completed'
      union all select b1, score_b, score_a from ${matches} where status = 'completed'
      union all select b2, score_b, score_a from ${matches} where status = 'completed'
    )
    select pid, count(*)::int as played, sum((pf > pa)::int)::int as won
    from sides where pid in (${sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `)})
    group by pid`);
  return new Map(rows.rows.map((r) => [r.pid, { played: Number(r.played), won: Number(r.won) }]));
}

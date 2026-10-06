import { and, asc, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import type { Transaction } from "@/lib/db/transaction";
import { matches, rounds, swissByes, swissPlayoffGames } from "@/lib/db/schema";
import { teamKey } from "@/lib/sessions/medal";
import type { PairKey, PlayedPlayoff, PlayoffKind, SwissGame } from "./engine";

export interface HistoryGame extends SwissGame {
  matchId: string;
}

export interface HistoryRound {
  roundId: string;
  /** Position among the session's rounds (all stages). */
  index: number;
  /** 1 for the first Swiss round, and so on. */
  number: number;
  games: HistoryGame[];
  bye: PairKey | null;
}

export interface HistoryPlayoff extends PlayedPlayoff {
  matchId: string;
  wave: 1 | 2;
}

export interface SwissHistory {
  /** Every pair, from the first round's games and bye. Empty before round 1. */
  keys: PairKey[];
  swissRounds: HistoryRound[];
  playoffs: HistoryPlayoff[];
  /** Playoff waves drawn so far: 0, 1 or 2. */
  playoffWaves: number;
}

type Reader = Transaction | ReturnType<typeof getDb>;

/**
 * A Swiss night as the rules see it, read from the stored rounds.
 *
 * Pairs come from the games themselves, not from the signups: the roster locks
 * at round 1, and the record has to describe the night that was played.
 */
export async function loadSwissHistory(db: Reader, sessionId: string): Promise<SwissHistory> {
  // Both clients expose the same query builder; the transaction type is the
  // narrower of the two, so the reads are written against it.
  const q = db as Transaction;
  const [roundRows, matchRows, byeRows] = await Promise.all([
    q.select({ id: rounds.id, index: rounds.index, stage: rounds.stage })
      .from(rounds).where(eq(rounds.sessionId, sessionId)).orderBy(asc(rounds.index)),
    q.select().from(matches).where(eq(matches.sessionId, sessionId)).orderBy(asc(matches.courtNo)),
    q.select().from(swissByes).where(eq(swissByes.sessionId, sessionId)),
  ]);
  const playoffIds = matchRows.filter((m) => roundRows.some((r) => r.id === m.roundId && r.stage !== "robin")).map((m) => m.id);
  const roles = playoffIds.length
    ? await q.select().from(swissPlayoffGames).where(and(
      eq(swissPlayoffGames.sessionId, sessionId), inArray(swissPlayoffGames.matchId, playoffIds)))
    : [];

  const game = (m: (typeof matchRows)[number]): HistoryGame => ({
    matchId: m.id,
    a: teamKey(m.a1, m.a2),
    b: teamKey(m.b1, m.b2),
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    status: m.status,
  });

  const swissRounds: HistoryRound[] = roundRows
    .filter((r) => r.stage === "robin")
    .map((r, i) => {
      const bye = byeRows.find((b) => b.roundId === r.id);
      return {
        roundId: r.id,
        index: r.index,
        number: i + 1,
        games: matchRows.filter((m) => m.roundId === r.id).map(game),
        bye: bye ? teamKey(bye.player1, bye.player2) : null,
      };
    });

  const playoffRounds = roundRows.filter((r) => r.stage !== "robin");
  const playoffs: HistoryPlayoff[] = [];
  for (const m of matchRows) {
    const role = roles.find((r) => r.matchId === m.id);
    const round = playoffRounds.find((r) => r.id === m.roundId);
    if (!role || !round) continue;
    playoffs.push({
      ...game(m),
      kind: role.kind as PlayoffKind,
      place: role.place,
      leg: role.leg,
      wave: round.stage === "semifinal" ? 1 : 2,
    });
  }

  const first = swissRounds[0];
  const keys = first
    ? [...first.games.flatMap((g) => [g.a, g.b]), ...(first.bye ? [first.bye] : [])]
    : [];

  return { keys, swissRounds, playoffs, playoffWaves: playoffRounds.length };
}

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { matches, players, ratingEvents, rounds } from "@/lib/db/schema";

/** Courts are stored by index; the name comes from the session. */
export function courtLabel(courtNames: string[], courtNo: number | null): string {
  if (courtNo === null) return "Court";
  return `Court ${courtNames[courtNo - 1] ?? courtNo}`;
}

export interface RoundMatch {
  id: string;
  courtNo: number | null;
  courtLabel: string;
  teamA: { id: string; username: string }[];
  teamB: { id: string; username: string }[];
  scoreA: number | null;
  scoreB: number | null;
  completed: boolean;
}

export interface CurrentRound {
  id: string;
  index: number;
  matches: RoundMatch[];
}

/**
 * Every round of a session, oldest first, with names resolved.
 *
 * Used by the player-facing session page and the admin play console alike, so
 * the two can never disagree about who is on which court.
 */
export async function getAllRounds(
  sessionId: string,
  courtNames: string[],
): Promise<CurrentRound[]> {
  const db = getDb();

  const [roundRows, matchRows] = await Promise.all([
    db
      .select({ id: rounds.id, index: rounds.index })
      .from(rounds)
      .where(eq(rounds.sessionId, sessionId))
      .orderBy(asc(rounds.index)),
    db
      .select({
        id: matches.id,
        roundId: matches.roundId,
        courtNo: matches.courtNo,
        a1: matches.a1,
        a2: matches.a2,
        b1: matches.b1,
        b2: matches.b2,
        scoreA: matches.scoreA,
        scoreB: matches.scoreB,
        status: matches.status,
      })
      .from(matches)
      .where(and(eq(matches.sessionId, sessionId), ne(matches.status, "void")))
      .orderBy(asc(matches.courtNo)),
  ]);

  if (roundRows.length === 0) return [];

  const ids = new Set<string>();
  for (const r of matchRows) for (const id of [r.a1, r.a2, r.b1, r.b2]) ids.add(id);

  const nameRows = ids.size
    ? await db
        .select({ id: players.id, username: players.username })
        .from(players)
        .where(inArray(players.id, [...ids]))
    : [];
  const nameOf = new Map(nameRows.map((n) => [n.id, n.username]));
  const person = (id: string) => ({ id, username: nameOf.get(id) ?? "?" });

  return roundRows.map((round) => ({
    id: round.id,
    index: round.index,
    matches: matchRows
      .filter((m) => m.roundId === round.id)
      .map((r) => ({
        id: r.id,
        courtNo: r.courtNo,
        courtLabel: courtLabel(courtNames, r.courtNo),
        teamA: [person(r.a1), person(r.a2)],
        teamB: [person(r.b1), person(r.b2)],
        scoreA: r.scoreA,
        scoreB: r.scoreB,
        completed: r.status === "completed",
      })),
  }));
}

export interface StandingRow {
  playerId: string;
  username: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Rating movement from this session alone; null if the session is unrated. */
  ratingDelta: number | null;
}

/**
 * Standings for *this session only*.
 *
 * Mid-session the global leaderboard is the wrong thing to look at — nobody
 * cares about their all-time rating while a night is in progress, they care who
 * is winning tonight. Computed from the session's completed matches rather than
 * from player_stats, which is cumulative.
 */
export async function getSessionStandings(sessionId: string): Promise<StandingRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      a1: matches.a1,
      a2: matches.a2,
      b1: matches.b1,
      b2: matches.b2,
      scoreA: matches.scoreA,
      scoreB: matches.scoreB,
      id: matches.id,
    })
    .from(matches)
    .where(and(eq(matches.sessionId, sessionId), eq(matches.status, "completed")));

  if (rows.length === 0) return [];

  const deltaRows = await db
    .select({ playerId: ratingEvents.playerId, delta: ratingEvents.delta })
    .from(ratingEvents)
    .where(
      inArray(
        ratingEvents.matchId,
        rows.map((r) => r.id),
      ),
    );

  const deltaBy = new Map<string, number>();
  for (const d of deltaRows) {
    deltaBy.set(d.playerId, (deltaBy.get(d.playerId) ?? 0) + d.delta);
  }

  const table = new Map<string, Omit<StandingRow, "username">>();
  const bump = (id: string) => {
    let row = table.get(id);
    if (!row) {
      row = { playerId: id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, ratingDelta: null };
      table.set(id, row);
    }
    return row;
  };

  for (const m of rows) {
    if (m.scoreA === null || m.scoreB === null) continue;
    const aWon = m.scoreA > m.scoreB;
    for (const [ids, mineScore, theirScore, won] of [
      [[m.a1, m.a2], m.scoreA, m.scoreB, aWon],
      [[m.b1, m.b2], m.scoreB, m.scoreA, !aWon],
    ] as const) {
      for (const id of ids) {
        const row = bump(id);
        if (won) row.wins += 1;
        else row.losses += 1;
        row.pointsFor += mineScore;
        row.pointsAgainst += theirScore;
      }
    }
  }

  const nameRows = await db
    .select({ id: players.id, username: players.username })
    .from(players)
    .where(inArray(players.id, [...table.keys()]));
  const nameOf = new Map(nameRows.map((n) => [n.id, n.username]));

  return [...table.values()]
    .map((r) => ({
      ...r,
      username: nameOf.get(r.playerId) ?? "?",
      ratingDelta: deltaBy.get(r.playerId) ?? null,
    }))
    .sort(
      (x, y) =>
        y.wins - x.wins ||
        y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst) ||
        x.username.localeCompare(y.username),
    );
}

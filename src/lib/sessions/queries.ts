import { and, asc, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { matches, players, rounds } from "@/lib/db/schema";

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
 * The round in play right now, with names resolved.
 *
 * Used by both the player-facing session page and the admin play console, so
 * the two can never disagree about who is on which court.
 */
export async function getCurrentRound(
  sessionId: string,
  courtNames: string[],
): Promise<CurrentRound | null> {
  const db = getDb();

  const latest = await db
    .select({ id: rounds.id, index: rounds.index })
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId))
    .orderBy(desc(rounds.index))
    .limit(1);

  const round = latest[0];
  if (!round) return null;

  const rows = await db
    .select({
      id: matches.id,
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
    .where(and(eq(matches.roundId, round.id), ne(matches.status, "void")))
    .orderBy(asc(matches.courtNo));

  const ids = new Set<string>();
  for (const r of rows) for (const id of [r.a1, r.a2, r.b1, r.b2]) ids.add(id);

  const nameRows = ids.size
    ? await db.select({ id: players.id, username: players.username }).from(players)
    : [];
  const nameOf = new Map(nameRows.map((n) => [n.id, n.username]));
  const person = (id: string) => ({ id, username: nameOf.get(id) ?? "?" });

  return {
    id: round.id,
    index: round.index,
    matches: rows.map((r) => ({
      id: r.id,
      courtNo: r.courtNo,
      courtLabel: courtLabel(courtNames, r.courtNo),
      teamA: [person(r.a1), person(r.a2)],
      teamB: [person(r.b1), person(r.b2)],
      scoreA: r.scoreA,
      scoreB: r.scoreB,
      completed: r.status === "completed",
    })),
  };
}

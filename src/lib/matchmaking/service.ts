/**
 * Bridges the pure round generator to the database.
 *
 * Session history is rebuilt from the stored matches every time rather than
 * cached, for the same reason ratings are (§5.6): if an admin voids a match or
 * edits a round, the next round is generated from what actually happened.
 */
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { matches, players, playerStats, rounds, sessions, signups } from "@/lib/db/schema";
import { RATING } from "@/lib/rating/constants";
import { getT } from "@/lib/i18n/server";
import {
  applyRound,
  emptyHistory,
  generateRound,
  type Format,
  type GenPlayer,
  type Round,
  type SessionHistory,
} from "./generator";

const GENERATOR_FORMATS: Format[] = [
  "regular",
  "balanced",
  "fixed",
  "social",
  "custom",
  "manual",
];

/** "king" was never implemented; fall back to balanced rather than lying. */
export function toGeneratorFormat(format: string): Format {
  return GENERATOR_FORMATS.includes(format as Format) ? (format as Format) : "balanced";
}

export interface AttendingPlayer extends GenPlayer {
  username: string;
}

/** Everyone marked present, with the rating the generator should balance on. */
export async function getAttending(sessionId: string): Promise<AttendingPlayer[]> {
  const rows = await getDb()
    .select({
      id: signups.playerId,
      username: players.username,
      rating: playerStats.rating,
    })
    .from(signups)
    .innerJoin(players, eq(players.id, signups.playerId))
    .leftJoin(playerStats, eq(playerStats.playerId, signups.playerId))
    .where(
      and(
        eq(signups.sessionId, sessionId),
        eq(signups.state, "in"),
        eq(signups.attended, true),
      ),
    )
    .orderBy(asc(signups.createdAt));

  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    // An unrated player still has to be placed somewhere; mid-scale is the
    // least-wrong guess and their first results correct it fast.
    rating: r.rating ?? RATING.DEFAULT_RATING,
  }));
}

/**
 * Replay this session's completed and scheduled matches into the history the
 * generator needs: who has partnered whom, who has faced whom, how many games
 * each player has had, and how often each has sat out.
 */
export async function buildSessionHistory(sessionId: string): Promise<SessionHistory> {
  const db = getDb();

  const [roundRows, matchRows, attending] = await Promise.all([
    db
      .select({ id: rounds.id, index: rounds.index })
      .from(rounds)
      .where(eq(rounds.sessionId, sessionId))
      .orderBy(asc(rounds.index)),
    db
      .select({
        roundId: matches.roundId,
        a1: matches.a1,
        a2: matches.a2,
        b1: matches.b1,
        b2: matches.b2,
      })
      .from(matches)
      .where(and(eq(matches.sessionId, sessionId), ne(matches.status, "void"))),
    getAttending(sessionId),
  ]);

  const present = new Set(attending.map((p) => p.id));
  let history = emptyHistory();

  for (const round of roundRows) {
    const inRound = matchRows.filter((m) => m.roundId === round.id);
    if (inRound.length === 0) continue;

    const played = new Set<string>();
    const courts = inRound.map((m, i) => {
      for (const id of [m.a1, m.a2, m.b1, m.b2]) played.add(id);
      return {
        courtNo: i + 1,
        teamA: [m.a1, m.a2] as [string, string],
        teamB: [m.b1, m.b2] as [string, string],
      };
    });

    const sittingOut = [...present].filter((id) => !played.has(id));
    history = applyRound(history, { courts, sittingOut });
  }

  return history;
}

/** Generate the next round and persist it as scheduled matches. */
export async function createNextRound(sessionId: string): Promise<{
  round: Round;
  roundIndex: number;
}> {
  const t = await getT();
  const db = getDb();

  const found = await db
    .select({ courtCount: sessions.courtCount, format: sessions.format })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const session = found[0];
  if (!session) throw new Error(t("err.sessionGone"));

  const attending = await getAttending(sessionId);
  if (attending.length < 4) {
    throw new Error(t("err.needFourPresent"));
  }

  const history = await buildSessionHistory(sessionId);
  const round = generateRound(attending, session.courtCount, history, {
    format: toGeneratorFormat(session.format),
  });

  const last = await db
    .select({ index: rounds.index })
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId))
    .orderBy(desc(rounds.index))
    .limit(1);

  const roundIndex = (last[0]?.index ?? 0) + 1;

  const inserted = await db
    .insert(rounds)
    .values({ sessionId, index: roundIndex, state: "active" })
    .returning({ id: rounds.id });

  const roundId = inserted[0].id;

  if (round.courts.length > 0) {
    await db.insert(matches).values(
      round.courts.map((c) => ({
        sessionId,
        roundId,
        courtNo: c.courtNo,
        a1: c.teamA[0],
        a2: c.teamA[1],
        b1: c.teamB[0],
        b2: c.teamB[1],
        status: "scheduled" as const,
      })),
    );
  }

  return { round, roundIndex };
}

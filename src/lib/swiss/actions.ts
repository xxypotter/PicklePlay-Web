"use server";

import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { inTransaction, lockSession, type Transaction } from "@/lib/db/transaction";
import { auditLog, matches, players, playerStats, rounds, sessions, signups, swissByes, swissPlayoffGames } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translate";
import { RATING } from "@/lib/rating/constants";
import { requireOrganizer } from "@/lib/sessions/guards";
import { teamKey, teamPlayers } from "@/lib/sessions/medal";
import {
  firstRound, maxSwissRounds, nextRound, playoffWave1, playoffWave2, swissStandings, validPairCount,
  SWISS_MIN_ROUNDS_BEFORE_PLAYOFFS, type Draw, type PairKey, type PlayoffGame,
} from "./engine";
import { loadSwissHistory } from "./history";

function refresh(id: string) {
  revalidatePath(`/s/${id}`);
  revalidatePath(`/s/${id}/play`);
}

/** The organizer, under the session lock, on a live Swiss session. */
async function organize(
  sessionId: string,
  work: (tx: Transaction, context: { actorId: string; t: T }) => Promise<void>,
): Promise<void> {
  const { me } = await requireOrganizer(sessionId);
  const t = await getT();
  await inTransaction(async (tx) => {
    await lockSession(tx, sessionId);
    const [session] = await tx.select({ status: sessions.status, format: sessions.format })
      .from(sessions).where(eq(sessions.id, sessionId));
    if (!session) throw new Error(t("err.sessionGone"));
    if (session.format !== "swiss") throw new Error(t("swiss.error.notSwiss"));
    if (session.status !== "live") throw new Error(t("err.startFirst"));
    await work(tx, { actorId: me.id, t });
  });
  refresh(sessionId);
}

/**
 * The pairs here tonight, for round 1: everyone present must have a mutual
 * partner — a Swiss night has no spare players — and there must be 6–12 pairs.
 */
async function presentPairs(tx: Transaction, sessionId: string, t: T) {
  const rows = await tx
    .select({ id: signups.playerId, partnerId: signups.partnerId, rating: playerStats.rating })
    .from(signups)
    .innerJoin(players, eq(players.id, signups.playerId))
    .leftJoin(playerStats, eq(playerStats.playerId, signups.playerId))
    .where(and(eq(signups.sessionId, sessionId), eq(signups.state, "in"), eq(signups.attended, true)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unpaired = rows.filter((r) => !r.partnerId || byId.get(r.partnerId)?.partnerId !== r.id);
  if (unpaired.length) throw new Error(t("swiss.error.pairs", { count: unpaired.length }));
  const pairs = rows
    .filter((r) => r.id < r.partnerId!)
    .map((r) => {
      const partner = byId.get(r.partnerId!)!;
      const rating = ((r.rating ?? RATING.DEFAULT_RATING) + (partner.rating ?? RATING.DEFAULT_RATING)) / 2;
      return { key: teamKey(r.id, partner.id), rating };
    });
  if (!validPairCount(pairs.length)) throw new Error(t("swiss.error.pairCount", { count: pairs.length }));
  return pairs;
}

/** Fisher–Yates with the platform's cryptographic generator. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function appendRound(tx: Transaction, sessionId: string, stage: "robin" | "semifinal" | "final") {
  const [last] = await tx.select({ n: sql<number>`coalesce(max(${rounds.index}),0)::int` })
    .from(rounds).where(eq(rounds.sessionId, sessionId));
  const [round] = await tx.insert(rounds)
    .values({ sessionId, index: last.n + 1, state: "active", stage })
    .returning({ id: rounds.id });
  return round.id;
}

/**
 * Games in court order: the top of the table on court 1. More games than
 * courts is fine — the rest take the next court that frees up, and their
 * court number runs past the last named court to say so.
 */
async function insertGames(tx: Transaction, sessionId: string, roundId: string, games: ReadonlyArray<{ a: PairKey; b: PairKey }>) {
  if (!games.length) return [];
  return tx.insert(matches).values(games.map((g, i) => {
    const [a1, a2] = teamPlayers(g.a);
    const [b1, b2] = teamPlayers(g.b);
    return { sessionId, roundId, courtNo: i + 1, a1, a2, b1, b2, status: "scheduled" as const };
  })).returning({ id: matches.id });
}

/**
 * Draw the next Swiss round. Round 1 needs a choice: seeded by pair rating
 * (strongest first, top half against bottom half) or random. Every later round
 * pairs equal records, highest against lowest, never a rematch.
 */
export async function drawSwissRoundAction(sessionId: string, seeded?: boolean): Promise<void> {
  await organize(sessionId, async (tx, { actorId, t }) => {
    const history = await loadSwissHistory(tx, sessionId);
    if (history.playoffWaves > 0) throw new Error(t("swiss.error.playoffsStarted"));

    let draw: Draw;
    if (history.swissRounds.length === 0) {
      if (typeof seeded !== "boolean") throw new Error(t("swiss.error.seeding"));
      const pairs = await presentPairs(tx, sessionId, t);
      const order = seeded
        ? [...pairs].sort((x, y) => y.rating - x.rating || (x.key < y.key ? -1 : 1)).map((p) => p.key)
        : shuffled(pairs.map((p) => p.key));
      draw = firstRound(order);
      await tx.update(sessions).set({ swissSeeded: seeded }).where(eq(sessions.id, sessionId));
    } else {
      if (history.swissRounds.some((r) => r.games.some((g) => g.status === "scheduled"))) {
        throw new Error(t("swiss.error.unscored"));
      }
      const next = history.swissRounds.length < maxSwissRounds(history.keys.length)
        ? nextRound(history.keys, history.swissRounds)
        : null;
      if (!next) throw new Error(t("swiss.error.noMoreRounds"));
      draw = next;
    }

    const roundId = await appendRound(tx, sessionId, "robin");
    await insertGames(tx, sessionId, roundId, draw.games);
    if (draw.bye) {
      const [player1, player2] = teamPlayers(draw.bye);
      await tx.insert(swissByes).values({ sessionId, roundId, player1, player2 });
    }
    await tx.insert(auditLog).values({
      actorId, action: "swiss.draw_round", targetType: "session", targetId: sessionId,
      detail: JSON.stringify({ round: history.swissRounds.length + 1, seeded: history.swissRounds.length ? undefined : seeded }),
    });
  });
}

async function insertPlayoffs(tx: Transaction, sessionId: string, stage: "semifinal" | "final", games: PlayoffGame[]) {
  const roundId = await appendRound(tx, sessionId, stage);
  const ids = await insertGames(tx, sessionId, roundId, games);
  await tx.insert(swissPlayoffGames).values(games.map((g, i) => ({
    matchId: ids[i].id, sessionId, kind: g.kind, place: g.place, leg: g.leg,
  })));
}

/**
 * The first playoff wave, seeded from the Swiss standings. From here the Swiss
 * results are locked (see guards.ts): the seeding was drawn from them.
 */
export async function startSwissPlayoffsAction(sessionId: string): Promise<void> {
  await organize(sessionId, async (tx, { actorId, t }) => {
    const history = await loadSwissHistory(tx, sessionId);
    if (history.playoffWaves > 0) throw new Error(t("swiss.error.playoffsStarted"));
    if (history.swissRounds.length < SWISS_MIN_ROUNDS_BEFORE_PLAYOFFS) throw new Error(t("swiss.error.tooFewRounds"));
    if (history.swissRounds.some((r) => r.games.some((g) => g.status === "scheduled"))) {
      throw new Error(t("swiss.error.unscored"));
    }
    const ranked = swissStandings(history.keys, history.swissRounds).map((r) => r.key);
    await insertPlayoffs(tx, sessionId, "semifinal", playoffWave1(ranked));
    await tx.insert(auditLog).values({
      actorId, action: "swiss.playoffs", targetType: "session", targetId: sessionId,
      detail: JSON.stringify({ afterRounds: history.swissRounds.length, seeds: ranked.length }),
    });
  });
}

/** The second wave: places for every group, the series' second game, the ladder's final. */
export async function drawSwissFinalsAction(sessionId: string): Promise<void> {
  await organize(sessionId, async (tx, { actorId, t }) => {
    const history = await loadSwissHistory(tx, sessionId);
    if (history.playoffWaves !== 1) throw new Error(t(history.playoffWaves ? "swiss.error.finalsDrawn" : "swiss.error.tooFewRounds"));
    const ranked = swissStandings(history.keys, history.swissRounds).map((r) => r.key);
    const wave2 = playoffWave2(ranked, history.playoffs.filter((g) => g.wave === 1));
    if (!wave2) throw new Error(t("swiss.error.unscored"));
    await insertPlayoffs(tx, sessionId, "final", wave2);
    await tx.insert(auditLog).values({
      actorId, action: "swiss.finals", targetType: "session", targetId: sessionId, detail: null,
    });
  });
}

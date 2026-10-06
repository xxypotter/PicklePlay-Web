/** Explicit opt-in. Never runs against production. Uses real DB/actions, mocked request identity only. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, matches, players, playerStats, rounds, sessions, signups, swissByes, swissPlayoffGames } from "@/lib/db/schema";
import { makeT } from "@/lib/i18n/translate";
import type { Actor } from "@/lib/auth/policy";
import { teamKey } from "@/lib/sessions/medal";
import { getAllRounds } from "@/lib/sessions/queries";
import { addPlayerAction, createSessionAction, setAttendanceAction, setPartnerAction } from "@/lib/sessions/actions";
import {
  createManualRoundAction, discardRoundAction, generateRoundAction, rebuildMatchupsAction,
  reopenSessionAction, saveScoreAction, startSessionAction,
} from "@/lib/sessions/play-actions";
import { drawSwissFinalsAction, drawSwissRoundAction, startSwissPlayoffsAction } from "./actions";
import { getSwissView } from "./view";

let actor: Actor;
class Redirected extends Error { constructor(public url: string) { super(url); } }
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Redirected(url); },
  notFound: () => { throw new Error("notFound"); },
}));
vi.mock("@/lib/auth/permissions", () => ({ requireLogin: async () => actor, requireAdmin: async () => actor, requireSuperAdmin: async () => actor }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => makeT("en") }));

describe.skipIf(process.env.RUN_DEV_INTEGRATION !== "1")("v1.9 Swiss rounds", () => {
  const ids: string[] = Array.from({ length: 26 }, () => randomUUID());
  const organizer = ids[0];
  const made: string[] = [];
  let verified = false;
  const t = makeT("en");
  const db = () => getDb();

  /** A live Swiss session with `pairs` pairs of players from `ids`, partners set through the action. */
  const swissSession = async (pairs: number, courts = 4) => {
    const id = randomUUID();
    made.push(id);
    await db().insert(sessions).values({ id, title: "Swiss integration", createdBy: organizer, format: "swiss",
      courtCount: courts, courtNames: Array.from({ length: courts }, (_, i) => String(i + 1)), maxPlayers: 24,
      status: "live", rated: false, startsAt: new Date() });
    const roster = ids.slice(0, pairs * 2);
    await db().insert(signups).values(roster.map((playerId) => ({ sessionId: id, playerId, state: "in" as const })));
    for (let i = 0; i < roster.length; i += 2) await setPartnerAction(id, roster[i], roster[i + 1]);
    return { id, roster };
  };
  const score = (matchId: string, a: number, b: number) => {
    const fd = new FormData(); fd.set("matchId", matchId); fd.set("scoreA", String(a)); fd.set("scoreB", String(b));
    return saveScoreAction({}, fd);
  };
  const stageGames = async (sessionId: string, stage: "robin" | "semifinal" | "final") => {
    const rs = await db().select().from(rounds).where(and(eq(rounds.sessionId, sessionId), eq(rounds.stage, stage))).orderBy(asc(rounds.index));
    const last = rs.at(-1);
    return last ? db().select().from(matches).where(eq(matches.roundId, last.id)).orderBy(asc(matches.courtNo)) : [];
  };
  /** Team A always wins, by a margin that falls with the court number (so standings have no full ties). */
  const scoreAll = async (games: Array<{ id: string; courtNo: number | null }>) => {
    for (const g of games) expect(await score(g.id, 11, Math.min(9, g.courtNo ?? 0))).toEqual({});
  };

  beforeAll(async () => {
    config({ path: ".env.local", quiet: true });
    if (new URL(process.env.DATABASE_URL!).pathname !== "/pickleplay_dev") throw new Error("Development DB required");
    const probe = await getDb().execute<{ name: string }>(sql`select current_database() as name`);
    if (probe.rows[0]?.name !== "pickleplay_dev") throw new Error("Development DB required");
    verified = true;
    actor = { id: organizer, role: "admin" };
    await db().insert(players).values(ids.map((pid, i) => ({ id: pid, username: `v19swiss_${pid}`, usernameLower: `v19swiss_${pid}`,
      pinHash: "disabled-test-only", role: i === 0 ? "admin" as const : "player" as const })));
    // Pair n (players 2n, 2n+1) is the n-th strongest, so a seeded draw is predictable.
    await db().insert(playerStats).values(ids.map((playerId, i) => ({
      playerId, rating: 5 - Math.floor(i / 2) * 0.1, peakRating: 5, reliability: 0.5, halfLife: 10,
    })));
  }, 30000);
  afterAll(async () => {
    if (!verified) return;
    if (made.length) await db().delete(sessions).where(inArray(sessions.id, made));
    await db().delete(auditLog).where(inArray(auditLog.actorId, ids));
    await db().delete(players).where(inArray(players.id, ids));
  }, 30000);

  it("runs eight seeded pairs through three rounds, playoffs and finals, with every lock in place", async () => {
    const { id, roster } = await swissSession(8);
    const pair = (n: number) => teamKey(roster[n * 2], roster[n * 2 + 1]);

    // Round 1 needs a seeding choice and everyone here paired.
    await expect(drawSwissRoundAction(id)).rejects.toThrow(t("swiss.error.seeding"));
    await setPartnerAction(id, roster[0], null);
    await expect(drawSwissRoundAction(id, true)).rejects.toThrow(t("swiss.error.pairs", { count: 2 }));
    await setPartnerAction(id, roster[0], roster[1]);
    // Regular generators are refused for Swiss.
    await expect(generateRoundAction(id)).rejects.toThrow(t("swiss.error.managed"));

    await drawSwissRoundAction(id, true);
    const r1 = await stageGames(id, "robin");
    expect(r1.map((g) => [teamKey(g.a1, g.a2), teamKey(g.b1, g.b2)])).toEqual([
      [pair(0), pair(4)], [pair(1), pair(5)], [pair(2), pair(6)], [pair(3), pair(7)],
    ]);
    expect(r1.map((g) => g.courtNo)).toEqual([1, 2, 3, 4]);
    expect((await db().select().from(sessions).where(eq(sessions.id, id)))[0].swissSeeded).toBe(true);

    // Roster, pairs and other round builders lock at round 1.
    await expect(setAttendanceAction(id, roster[0], false)).rejects.toThrow(t("swiss.error.rosterLocked"));
    await expect(setPartnerAction(id, roster[0], roster[2])).rejects.toThrow(t("swiss.error.rosterLocked"));
    await expect(addPlayerAction(id, ids[20])).rejects.toThrow(t("swiss.error.rosterLocked"));
    await expect(rebuildMatchupsAction(id, 3)).rejects.toThrow(t("swiss.error.managed"));
    await expect(createManualRoundAction(id, [[roster[0], roster[1], roster[2], roster[3]]])).rejects.toThrow(t("swiss.error.managed"));
    await expect(drawSwissRoundAction(id)).rejects.toThrow(t("swiss.error.unscored"));
    await expect(startSwissPlayoffsAction(id)).rejects.toThrow(t("swiss.error.tooFewRounds"));

    await scoreAll(r1);
    for (let round = 2; round <= 3; round++) {
      await drawSwissRoundAction(id);
      const games = await stageGames(id, "robin");
      const view = await getSwissView(id, true);
      // Same records meet, and nobody meets anyone twice.
      expect(view.rounds.at(-1)!.games.every((g) => g.recordA === g.recordB)).toBe(true);
      await scoreAll(games);
    }
    const view = await getSwissView(id, true);
    expect(view.standings.map((r) => r.wins)).toEqual([3, 2, 2, 2, 1, 1, 1, 0]);
    const all = view.rounds.flatMap((r) => r.games.map((g) => [g.a, g.b].sort().join("#")));
    expect(new Set(all).size).toBe(12);

    // A Swiss correction is fine while no playoffs exist; the draw already made stays.
    const firstGame = r1[0];
    expect(await score(firstGame.id, 11, 2)).toEqual({});

    await startSwissPlayoffsAction(id);
    const semis = await stageGames(id, "semifinal");
    const seeds = (await getSwissView(id, true)).standings.map((r) => r.key);
    expect(semis.map((g) => [teamKey(g.a1, g.a2), teamKey(g.b1, g.b2)])).toEqual([
      [seeds[0], seeds[3]], [seeds[1], seeds[2]], [seeds[4], seeds[7]], [seeds[5], seeds[6]],
    ]);
    expect((await db().select().from(swissPlayoffGames).where(eq(swissPlayoffGames.sessionId, id))).map((r) => [r.kind, r.place, r.leg]).sort())
      .toEqual([["semi", 1, 1], ["semi", 1, 2], ["semi", 5, 1], ["semi", 5, 2]]);
    // Swiss results now lock: the seeding came from them. Score entry and 0–0 clearing both refuse.
    expect((await score(firstGame.id, 11, 3)).error).toBe(t("swiss.error.downstream"));
    expect((await score(firstGame.id, 0, 0)).error).toBe(t("swiss.error.downstream"));
    await expect(drawSwissRoundAction(id)).rejects.toThrow(t("swiss.error.playoffsStarted"));
    await expect(drawSwissFinalsAction(id)).rejects.toThrow(t("swiss.error.unscored"));

    // Higher seeds win semi 1 of each group; lower seeds win semi 2.
    for (const [i, g] of semis.entries()) expect(await score(g.id, i % 2 ? 4 : 11, i % 2 ? 11 : 4)).toEqual({});
    await drawSwissFinalsAction(id);
    let finals = await stageGames(id, "final");
    expect(finals.map((g) => [teamKey(g.a1, g.a2), teamKey(g.b1, g.b2)])).toEqual([
      [seeds[0], seeds[2]], [seeds[3], seeds[1]], [seeds[4], seeds[6]], [seeds[7], seeds[5]],
    ]);
    expect((await score(semis[0].id, 2, 11)).error).toBe(t("swiss.error.downstream"));

    // Discarding the unplayed finals unlocks the semis and redraws the same games.
    const finalRound = (await db().select().from(rounds).where(and(eq(rounds.sessionId, id), eq(rounds.stage, "final"))))[0];
    await discardRoundAction(id, finalRound.id);
    expect(await db().select().from(swissPlayoffGames).where(and(eq(swissPlayoffGames.sessionId, id), inArray(swissPlayoffGames.matchId, finals.map((g) => g.id))))).toHaveLength(0);
    await drawSwissFinalsAction(id);
    finals = await stageGames(id, "final");
    await scoreAll(finals);

    const done = await getSwissView(id, true);
    expect(done.phase).toBe("done");
    expect(done.places).toEqual([seeds[0], seeds[2], seeds[3], seeds[1], seeds[4], seeds[6], seeds[7], seeds[5]]);
    // Labels in Matchups say what each playoff game decides.
    const shown = await getAllRounds(id, ["1", "2", "3", "4"], "en", { waitingBeyondCourts: true });
    expect(shown.at(-1)!.title).toBe(t("swiss.playoffRound", { n: 2 }));
    expect(shown.at(-1)!.matches.map((m) => m.stageLabel)).toEqual([
      t("match.gold"), t("match.bronze"), t("swiss.label.place", { from: 5, to: 6 }), t("swiss.label.place", { from: 7, to: 8 }),
    ]);
    await expect(reopenSessionAction(id)).rejects.toThrow(t("err.resultsExist"));
  }, 300000);

  it("gives seven random pairs one bye a round, never twice, and a ladder for the last three", async () => {
    const { id } = await swissSession(7);
    await drawSwissRoundAction(id, false);
    for (let round = 1; round <= 3; round++) {
      if (round > 1) await drawSwissRoundAction(id);
      await scoreAll(await stageGames(id, "robin"));
    }
    const byes = await db().select().from(swissByes).where(eq(swissByes.sessionId, id));
    expect(byes).toHaveLength(3);
    expect(new Set(byes.map((b) => teamKey(b.player1, b.player2))).size).toBe(3);
    const view = await getSwissView(id, false);
    expect(view.seeded).toBe(false);
    // Every pair has three results: games plus at most one bye.
    expect(view.standings.every((r) => r.wins + r.losses === 3 && r.byes <= 1)).toBe(true);

    await startSwissPlayoffsAction(id);
    const w1 = await stageGames(id, "semifinal");
    expect(w1).toHaveLength(3); // two semis and the first ladder game; one pair waits
    await scoreAll(w1);
    await drawSwissFinalsAction(id);
    await scoreAll(await stageGames(id, "final"));
    const done = await getSwissView(id, false);
    expect(done.phase).toBe("done");
    expect([...done.places!].sort()).toEqual([...view.standings.map((r) => r.key)].sort());
  }, 300000);

  it("puts twelve pairs on four courts with the extra games waiting for a court, and goes back to setup cleanly", async () => {
    const { id, roster } = await swissSession(12);
    await drawSwissRoundAction(id, true);
    const shown = await getAllRounds(id, ["1", "2", "3", "4"], "en", { waitingBeyondCourts: true });
    expect(shown[0].matches.map((m) => m.courtLabel)).toEqual([
      t("schedule.court", { name: "1" }), t("schedule.court", { name: "2" }), t("schedule.court", { name: "3" }),
      t("schedule.court", { name: "4" }), t("schedule.nextCourt"), t("schedule.nextCourt"),
    ]);
    expect(shown[0].matches.filter((m) => m.waiting)).toHaveLength(2);
    // Elsewhere, a court number past the names keeps its plain label.
    const plain = await getAllRounds(id, ["1", "2", "3", "4"], "en");
    expect(plain[0].matches[5].courtLabel).toBe(t("schedule.court", { name: 6 }));

    // Nothing scored: Back to setup removes the draw and unlocks the pairs.
    await reopenSessionAction(id);
    expect(await db().select().from(rounds).where(eq(rounds.sessionId, id))).toHaveLength(0);
    await startSessionAction(id);
    await setPartnerAction(id, roster[0], roster[2]);
    await setPartnerAction(id, roster[1], roster[3]);
    await drawSwissRoundAction(id, false);
    expect(await stageGames(id, "robin")).toHaveLength(6);
  }, 300000);

  it("refuses Swiss sessions outside 4–6 courts and 12–24 players", async () => {
    const create = async (courts: string, max: string) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ title: "Swiss form", startsAt: new Date().toISOString(), courtNames: courts, format: "swiss", maxPlayers: max })) fd.set(k, v);
      try { return await createSessionAction({}, fd); } catch (e) {
        if (e instanceof Redirected) { made.push(e.url.split("/").pop()!); return "created"; }
        throw e;
      }
    };
    expect(await create("1, 2, 3", "16")).toEqual({ error: t("swiss.error.setup") });
    expect(await create("1, 2, 3, 4", "10")).toEqual({ error: t("swiss.error.setup") });
    expect(await create("1, 2, 3, 4, 5, 6, 7", "16")).toMatchObject({ field: "courtNames" });
    expect(await create("1, 2, 3, 4, 5, 6", "24")).toBe("created");
  }, 60000);
});

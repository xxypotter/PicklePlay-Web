/** Independent audit of b4b1a42. Synthetic data only; all DB entry points are mocked.
 * The scripted persistence double verifies action payloads, not PostgreSQL semantics.
 * Run: npm.cmd test -- src/lib/mlp/independent-audit.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { matches, mlpTeams, mlpTies, players, rounds, sessions, signups } from "@/lib/db/schema";
import { makeT } from "@/lib/i18n/translate";
import { copySourceFrom, type CopyableSession } from "@/lib/sessions/copy";
import { createSessionAction } from "@/lib/sessions/actions";
import { updateSessionAction } from "@/lib/sessions/edit-actions";
import { courtLabel, getAllRounds } from "@/lib/sessions/queries";
import { getMlpData } from "./queries";
import { addMlpPlayoffAction, createMlpScheduleAction } from "./actions";
import { lineups, outcome, podium, roundRobinReady, standings, validateTeams,
  type Encounter, type GameKind, type Team } from "./rules";
import { roundRobinSchedule, type PlannedEncounter } from "./schedule";
import MlpCourtHint from "@/components/mlp/MlpCourtHint";
import MlpSetup from "@/components/mlp/MlpSetup";
import SessionForm from "@/app/sessions/new/SessionForm";
import EditForm from "@/app/s/[id]/edit/EditForm";

const context = vi.hoisted(() => ({ db: null as unknown, locale: "en" as "en" | "zh-Hans" | "zh-Hant" }));
vi.mock("@/lib/db", () => ({ getDb: () => { assert(context.db, "Unexpected DB access"); return context.db; } }));
vi.mock("@/lib/db/transaction", () => ({
  inTransaction: async (work: (db: unknown) => Promise<unknown>) => {
    assert(context.db, "Unexpected transaction"); return work(context.db);
  }, lockSession: vi.fn(),
}));
vi.mock("@/lib/auth/permissions", () => ({
  requireAdmin: async () => ({ id: "audit-organizer", role: "admin" }),
  requireLogin: async () => ({ id: "audit-organizer", role: "admin" }),
}));
vi.mock("@/lib/sessions/guards", () => ({ requireOrganizer: async () => ({ me: { id: "audit-organizer", role: "admin" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => makeT(context.locale) }));
vi.mock("@/lib/i18n/client", () => ({ useT: () => makeT(context.locale) }));

const kinds: GameKind[] = ["women", "men", "mixed1", "mixed2"];
const labels = ["North", "南场", "Court & A", "001", "Center <5>", "1234567890123456"];
const combinations = [4, 5, 6].flatMap(count => [4, 5, 6].map(courts => ({ count, courts })));
const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
const rosterOf = (teams: Team[]) => teams.flatMap(t => [t.m1, t.w1, t.m2, t.w2]);

function permutations<T>(values: T[]): T[][] {
  return values.length ? values.flatMap((v, i) => permutations(values.filter((_, j) => i !== j)).map(t => [v, ...t])) : [[]];
}
const orders = permutations([0, 1, 2, 3]);
function squad(i: number, mixed = orders[0], opening = orders[7]): Team {
  const p = [0, 1, 2, 3].map(n => `player-${i}-${n}`);
  return { id: `team-${i}`, slot: i + 1, name: `Squad ${i}`,
    m1: p[mixed[0]], w1: p[mixed[1]], m2: p[mixed[2]], w2: p[mixed[3]],
    women1: p[opening[0]], women2: p[opening[1]], men1: p[opening[2]], men2: p[opening[3]] };
}
function chosen(t: Team, kind: GameKind): string[] {
  // Independent expectation: do not call teamLineups/lineups to compute it.
  switch (kind) {
    case "women": return [t.women1 ?? t.w1, t.women2 ?? t.w2];
    case "men": return [t.men1 ?? t.m1, t.men2 ?? t.m2];
    case "mixed1": return [t.m1, t.w1];
    case "mixed2": return [t.m2, t.w2];
  }
}
interface AuditGame { encounter: string; a: string; b: string; kind: GameKind; wave: number; court: number; people: string[] }
function materialize(plan: PlannedEncounter[], teams: Team[]): AuditGame[] {
  return plan.flatMap((tie, i) => {
    const [a, b] = tie.teams.map(n => teams[n]);
    const actual = lineups(a, b);
    return tie.games.map(g => ({ encounter: String(i), a: a.id, b: b.id, ...g,
      people: actual.find(x => x.kind === g.kind)!.players }));
  });
}
function chronologicalOracle(games: AuditGame[], teams: Team[], courts: number, completeRobin = true) {
  const byTeam = new Map(teams.map(t => [t.id, t]));
  const ties = new Map<string, AuditGame[]>();
  const usage = new Map<string, Set<number>>();
  const courtSlots = new Set<string>();
  for (const g of [...games].sort((a, b) => a.wave - b.wave || a.court - b.court)) {
    assert(Number.isInteger(g.wave) && g.wave >= 0, "invalid wave");
    assert(Number.isInteger(g.court) && g.court >= 1 && g.court <= courts, "invalid court");
    const slot = `${g.wave}:${g.court}`;
    assert(!courtSlots.has(slot), `court collision ${slot}`); courtSlots.add(slot);
    assert(g.a !== g.b && byTeam.has(g.a) && byTeam.has(g.b), "invalid opponent");
    assert.deepEqual(g.people, [...chosen(byTeam.get(g.a)!, g.kind), ...chosen(byTeam.get(g.b)!, g.kind)], "lineup changed");
    assert.equal(new Set(g.people).size, 4, "duplicate player inside match");
    for (const p of g.people) {
      const waves = usage.get(p) ?? new Set<number>();
      assert(!waves.has(g.wave), `player collision ${p} wave ${g.wave}`);
      waves.add(g.wave); usage.set(p, waves);
    }
    const encounter = ties.get(g.encounter) ?? [];
    encounter.push(g); ties.set(g.encounter, encounter);
  }
  const edges = new Set<string>();
  for (const gs of ties.values()) {
    assert.deepEqual(gs.map(g => g.kind).sort(), [...kinds].sort(), "four unique categories required");
    assert(gs.every(g => g.a === gs[0].a && g.b === gs[0].b), "encounter opponents changed");
    const edge = pairKey(gs[0].a, gs[0].b);
    assert(!edges.has(edge), "repeated encounter"); edges.add(edge);
    assert(Math.max(...gs.filter(g => g.kind === "women" || g.kind === "men").map(g => g.wave)) <
      Math.min(...gs.filter(g => g.kind.startsWith("mixed")).map(g => g.wave)), "mixed begins before opening finishes");
  }
  // Stronger than a same-wave clash check: an encounter must finish entirely
  // before either squad begins its next opponent, even with disjoint pairs.
  for (const t of teams) {
    const intervals = [...ties.values()].filter(gs => gs[0].a === t.id || gs[0].b === t.id)
      .map(gs => [Math.min(...gs.map(g => g.wave)), Math.max(...gs.map(g => g.wave))])
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++) assert(intervals[i - 1][1] < intervals[i][0], `encounters overlap for ${t.id}`);
  }
  if (!completeRobin) return;
  assert.equal(edges.size, teams.length * (teams.length - 1) / 2);
  for (let a = 0; a < teams.length; a++) for (let b = a + 1; b < teams.length; b++) {
    assert(edges.has(pairKey(teams[a].id, teams[b].id)), "missing opponent");
  }
  const waves = teams.length === 4 ? 6 : teams.length === 5 ? 10 : courts === 4 ? 16 : courts === 5 ? 12 : 10;
  assert.deepEqual([...new Set(games.map(g => g.wave))].sort((a, b) => a - b), Array.from({ length: waves }, (_, i) => i));
  assert.equal(usage.size, teams.length * 4);
  for (const p of rosterOf(teams)) assert.equal(usage.get(p)?.size, 2 * (teams.length - 1), `unequal work for ${p}`);
  if (teams.length === 6 && courts > 4) {
    for (let w = 0; w < waves; w++) assert.equal(games.filter(g => g.wave === w).length, courts, `idle court in wave ${w}`);
    if (courts === 5) for (const t of teams) {
      const single = games.filter(g => g.court === 5 && (g.a === t.id || g.b === t.id));
      assert.equal(single.length, 4); assert.equal(new Set(single.map(g => g.encounter)).size, 1);
      for (const p of rosterOf([t])) assert.equal(single.filter(g => g.people.includes(p)).length, 2);
    }
  }
}

describe("independent combinatorial and chronological audit", () => {
  it.each([4, 5, 6])("exhausts 576 ordered lineup assignments in each of six roles on %i courts", courts => {
    // 6 choices of first pair in each phase => 36 distinct partitions; swapping
    // members in four pairs gives 16 orders each, hence 576 ordered assignments.
    // Team namespaces are disjoint. Exhausting each role is compositional; we
    // do not claim to enumerate the impossible 576^6 Cartesian product.
    const plan = roundRobinSchedule(6, courts);
    for (let role = 0; role < 6; role++) for (const mixed of orders) for (const opening of orders) {
      const teams = Array.from({ length: 6 }, (_, i) => squad(i));
      teams[role] = squad(role, mixed, opening);
      assert(validateTeams(teams, new Set(rosterOf(teams)), 6));
      chronologicalOracle(materialize(plan, teams), teams, courts);
    }
  }, 60_000);

  it.each([4, 5, 6])("checks all 720 six-team relabelings on %i courts", courts => {
    for (const order of permutations([0, 1, 2, 3, 4, 5])) {
      const teams = order.map((id, i) => ({ ...squad(id, orders[(id * 7 + i) % 24], orders[(id * 11 + i) % 24]), slot: i + 1 }));
      chronologicalOracle(materialize(roundRobinSchedule(6, courts), teams), teams, courts);
    }
  }, 60_000);

  it.each(combinations)("seeded simultaneous lineup changes: $count teams / $courts courts", ({ count, courts }) => {
    let seed = 0xb4b1a42 ^ (count * 10 + courts);
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    for (let trial = 0; trial < 128; trial++) {
      const ids = Array.from({ length: count }, (_, i) => i);
      for (let i = count - 1; i > 0; i--) { const j = random() % (i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      const teams = ids.map((id, slot) => ({ ...squad(id, orders[random() % 24], orders[random() % 24]), slot: slot + 1 }));
      const before = JSON.stringify(teams);
      chronologicalOracle(materialize(roundRobinSchedule(count, courts), teams), teams, courts);
      assert.equal(JSON.stringify(teams), before);
    }
  });

  it("matches the literal pre-extension four-court schedule, not another current planner helper", () => {
    // Frozen from b4b1a42^ rules.ts / appendBlocks, not robinBlocks at runtime.
    const old: Record<number, number[][][]> = {
      4: [[[0,3],[1,2]], [[0,2],[3,1]], [[0,1],[2,3]]],
      5: [[[1,4],[2,3]], [[0,4],[1,2]], [[0,3],[4,2]], [[0,2],[3,1]], [[0,1],[3,4]]],
      6: [[[0,1],[2,3]], [[0,4],[1,5]], [[2,4],[3,5]], [[0,2],[1,3]], [[0,5],[1,4]], [[2,5],[3,4]], [[0,3],[1,2]], [[4,5]]],
    };
    for (const count of [4, 5, 6]) {
      const expected = old[count].flatMap((block, b) => block.map((teams, c) => ({ teams, block: b + 1, games: [
        { kind: "women", wave: b * 2, court: c * 2 + 1 }, { kind: "men", wave: b * 2, court: c * 2 + 2 },
        { kind: "mixed1", wave: b * 2 + 1, court: c * 2 + 1 }, { kind: "mixed2", wave: b * 2 + 1, court: c * 2 + 2 },
      ] })));
      expect(roundRobinSchedule(count, 4)).toEqual(expected);
      if (count < 6) for (const courts of [5, 6]) expect(roundRobinSchedule(count, courts)).toEqual(expected);
    }
  });

  it("the oracle detects court collisions, lineup substitution, and missing encounters", () => {
    const teams = Array.from({ length: 6 }, (_, i) => squad(i));
    const games = materialize(roundRobinSchedule(6, 5), teams);
    const collided = structuredClone(games);
    const sameWave = collided.find((g, i) => i > 0 && g.wave === collided[0].wave)!;
    sameWave.court = collided[0].court;
    expect(() => chronologicalOracle(collided, teams, 5)).toThrow(/court collision/);
    const substituted = structuredClone(games); substituted[0].people[0] = "wrong-player";
    expect(() => chronologicalOracle(substituted, teams, 5)).toThrow(/lineup changed/);
    expect(() => chronologicalOracle(games.filter(g => g.encounter !== "0"), teams, 5)).toThrow();
  });

  it("the oracle detects player clashes and interleaved encounters even without same-wave collisions", () => {
    const teams = Array.from({ length: 6 }, (_, i) => squad(i));
    const plan = roundRobinSchedule(6, 5);
    const first = plan[0];
    const second = plan.find(t => t !== first && t.teams.includes(first.teams[0]))!;
    const games = materialize([first, second], teams);
    // Two otherwise valid encounters use alternate waves; no player or court
    // collides in a wave, but the first encounter has not finished at wave 1.
    games.forEach((g, i) => { g.wave = (i % 4) * 2 + Math.floor(i / 4); g.court = 1; });
    expect(() => chronologicalOracle(games, teams, 5, false)).toThrow(/encounters overlap/);
    const clash = materialize([first], teams);
    clash.forEach((g, i) => { g.wave = i; g.court = 1; });
    clash[2].wave = 0; clash[2].court = 2;
    expect(() => chronologicalOracle(clash, teams, 5, false)).toThrow(/player collision/);
  });
});

type Row = Record<string, unknown>;
/** Strict read script; never evaluates SQL or imports the real DB driver. */
class MemoryWrites {
  reads: Array<{ table: unknown; rows: Row[] }> = [];
  writes: Array<{ table: unknown; rows: Row[] }> = [];
  updates: Array<{ table: unknown; values: Row; predicate: SQL }> = [];
  updateResult: Row[] = [{ id: "audit-session" }];
  serial = 0;
  queue(table: unknown, rows: Row[]) { this.reads.push({ table, rows }); }
  select() {
    return { from: (table: unknown) => {
      const next = this.reads.shift(); assert(next, "Unexpected SELECT"); assert.equal(table, next.table, "Unexpected read order/table");
      const result = Promise.resolve(structuredClone(next.rows));
      const chain = { where: () => chain, orderBy: () => chain,
        innerJoin: () => chain, leftJoin: () => chain, limit: () => chain, then: result.then.bind(result) };
      return chain;
    } };
  }
  insert(table: unknown) {
    return { values: (input: Row | Row[]) => {
      const rows = (Array.isArray(input) ? input : [input]).map(r => ({
        id: `audit-${++this.serial}`, scoreA: null, scoreB: null, tiebreakWinner: null, enteredBy: null, editedAt: null, ...r,
      }));
      this.writes.push({ table, rows });
      // Deliberately scramble RETURNING. Caller must match rounds by index.
      const result = Promise.resolve(rows);
      return { returning: async () => structuredClone([...rows].reverse()), then: result.then.bind(result) };
    } };
  }
  update(table: unknown) {
    return { set: (values: Row) => ({ where: (predicate: SQL) => {
      this.updates.push({ table, values, predicate }); return { returning: async () => this.updateResult };
    } }) };
  }
  rows<T>(table: unknown): T[] { return this.writes.filter(w => w.table === table).flatMap(w => w.rows) as T[]; }
  done() { expect(this.reads).toHaveLength(0); }
}
type SavedRound = typeof rounds.$inferSelect;
type SavedMatch = typeof matches.$inferSelect;
type SavedTie = typeof mlpTies.$inferSelect;
const sessionRow = (count: number, courts: number) => ({ id: "audit-session", status: "live", format: "mlp", maxPlayers: count * 4,
  courtCount: courts, courtNames: labels.slice(0, courts), createdBy: "audit-organizer" });
function queueDraw(db: MemoryWrites, teams: Team[], courts: number, existing: Row[] = []) {
  db.queue(sessions, [sessionRow(teams.length, courts)]); db.queue(rounds, existing);
  if (existing.length) return;
  db.queue(mlpTeams, teams.map(t => ({ ...t }))); db.queue(signups, rosterOf(teams).map(id => ({ id })));
  db.queue(rounds, [{ n: 0 }]); db.queue(mlpTies, [{ n: 0, block: 0 }]);
}
function asEncounters(db: MemoryWrites): Encounter[] {
  const gs = db.rows<SavedMatch>(matches);
  return db.rows<SavedTie>(mlpTies).map(t => ({ ...t, games: gs.filter(g => g.mlpTieId === t.id)
    .map(g => ({ kind: g.mlpGame, status: g.status, scoreA: g.scoreA, scoreB: g.scoreB })) }));
}
function queuePlayoff(db: MemoryWrites, teams: Team[], courts: number, ready: boolean) {
  db.queue(sessions, [sessionRow(teams.length, courts)]); db.queue(mlpTeams, teams.map(t => ({ ...t })));
  db.queue(mlpTies, db.rows<Row>(mlpTies)); db.queue(matches, db.rows<Row>(matches));
  if (ready) {
    db.queue(rounds, [{ n: Math.max(...db.rows<SavedRound>(rounds).map(r => r.index)) }]);
    const ts = db.rows<SavedTie>(mlpTies);
    db.queue(mlpTies, [{ n: Math.max(...ts.map(t => t.index)), block: Math.max(...ts.map(t => t.block)) }]);
  }
}
function savedGames(db: MemoryWrites, stage = "robin"): AuditGame[] {
  const rs = new Map(db.rows<SavedRound>(rounds).map(r => [r.id, r]));
  const ts = new Map(db.rows<SavedTie>(mlpTies).map(t => [t.id, t]));
  return db.rows<SavedMatch>(matches).filter(g => rs.get(g.roundId!)?.stage === stage).map(g => {
    const t = ts.get(g.mlpTieId!)!;
    return { encounter: t.id, a: t.teamAId, b: t.teamBId, kind: g.mlpGame as GameKind,
      wave: rs.get(g.roundId!)!.index - 1, court: g.courtNo!, people: [g.a1, g.a2, g.b1, g.b2] };
  });
}
beforeEach(() => { context.db = null; context.locale = "en"; });

describe("real actions and UI queries with synthetic persistence", () => {
  it.each(combinations)("persists full tournament correctly: $count teams / $courts courts", async ({ count, courts }) => {
    const db = new MemoryWrites(); context.db = db;
    const teams = Array.from({ length: count }, (_, i) => squad(i, orders[(i * 3) % 24], orders[(i * 7) % 24]));
    queueDraw(db, teams, courts); await createMlpScheduleAction("audit-session"); db.done();
    chronologicalOracle(savedGames(db), teams, courts);
    const rr = db.rows<SavedRound>(rounds);
    const robinWaveCount = rr.length;
    for (const r of rr) {
      const timestamps = new Set(db.rows<SavedMatch>(matches).filter(g => g.roundId === r.id).map(g => g.playedAt.getTime()));
      expect(timestamps.size).toBe(1);
    }
    const stamp = (r: SavedRound) => db.rows<SavedMatch>(matches).find(g => g.roundId === r.id)!.playedAt.getTime();
    for (let i = 1; i < rr.length; i++) expect(stamp(rr[i])).toBe(stamp(rr[0]) + i);
    // Pending games prevent playoffs; a completed exact RR tie is a draw.
    queuePlayoff(db, teams, courts, false);
    await expect(addMlpPlayoffAction("audit-session")).rejects.toThrow(makeT("en")("mlp.error.playoffReady")); db.done();
    const ts = db.rows<SavedTie>(mlpTies);
    const rank = new Map(teams.slice().reverse().map((t, i) => [t.id, i]));
    for (const tie of ts) for (const g of db.rows<SavedMatch>(matches).filter(g => g.mlpTieId === tie.id)) {
      const aWins = rank.get(tie.teamAId)! < rank.get(tie.teamBId)!;
      g.scoreA = aWins ? 11 : 1; g.scoreB = aWins ? 1 : 11; g.status = "completed";
    }
    const tiedGames = db.rows<SavedMatch>(matches).filter(g => g.mlpTieId === ts[0].id);
    const originals = tiedGames.map(g => ({ scoreA: g.scoreA, scoreB: g.scoreB }));
    tiedGames.forEach((g, i) => { g.scoreA = i < 2 ? 11 : 1; g.scoreB = i < 2 ? 1 : 11; });
    expect(outcome(asEncounters(db)[0]).reason).toBe("draw");
    expect(roundRobinReady(teams, asEncounters(db))).toBe(true);
    tiedGames.forEach((g, i) => Object.assign(g, originals[i]));
    expect(roundRobinReady(teams, asEncounters(db))).toBe(true);
    const expectedSeeds = teams.slice().reverse().map(t => t.id);
    expect(standings(teams, asEncounters(db)).map(r => r.team.id)).toEqual(expectedSeeds);
    const history = structuredClone(db.rows<SavedMatch>(matches));
    queuePlayoff(db, teams, courts, true); await addMlpPlayoffAction("audit-session"); db.done();
    const semis = db.rows<SavedTie>(mlpTies).filter(t => t.stage === "semifinal");
    expect(semis.map(t => [t.teamAId, t.teamBId])).toEqual([[expectedSeeds[0], expectedSeeds[3]], [expectedSeeds[1], expectedSeeds[2]]]);
    chronologicalOracle(savedGames(db, "semifinal"), teams, courts, false);
    expect(db.rows<SavedRound>(rounds).filter(r => r.stage === "semifinal").map(r => r.index)).toEqual([robinWaveCount + 1, robinWaveCount + 2]);
    for (const g of db.rows<SavedMatch>(matches).filter(g => semis.some(s => s.id === g.mlpTieId))) {
      g.status = "completed"; g.scoreA = 11; g.scoreB = 8;
    }
    queuePlayoff(db, teams, courts, true); await addMlpPlayoffAction("audit-session"); db.done();
    const finals = db.rows<SavedTie>(mlpTies).filter(t => t.stage === "final");
    expect(finals.map(t => [t.teamAId, t.teamBId])).toEqual([[expectedSeeds[0], expectedSeeds[1]], [expectedSeeds[3], expectedSeeds[2]]]);
    expect(db.rows<SavedRound>(rounds).filter(r => r.stage === "final").map(r => r.index)).toEqual([robinWaveCount + 3, robinWaveCount + 4]);
    chronologicalOracle(savedGames(db, "final"), teams, courts, false);
    for (const [i, tie] of finals.entries()) {
      const gs = db.rows<SavedMatch>(matches).filter(g => g.mlpTieId === tie.id);
      expect(gs.map(g => g.courtNo)).toEqual(i === 0 ? [1,2,1,2] : [3,4,3,4]);
      // 2–2 games, unequal total points: A wins both medal encounters.
      gs.forEach((g, n) => { g.status = "completed"; g.scoreA = n < 2 ? 11 : 9; g.scoreB = n < 2 ? 2 : 11; });
    }
    expect(podium(asEncounters(db))).toEqual([{ place: 1, teamId: expectedSeeds[0] }, { place: 2, teamId: expectedSeeds[1] }, { place: 3, teamId: expectedSeeds[3] }]);
    expect(db.rows<SavedMatch>(matches).slice(0, history.length)).toEqual(history);
    // UI reader must use stored round IDs, including court 5's four waves.
    db.queue(rounds, db.rows<Row>(rounds));
    db.queue(matches, [...db.rows<SavedMatch>(matches)].sort((a, b) => a.courtNo! - b.courtNo!));
    db.queue(players, rosterOf(teams).map(id => ({ id, username: id, avatar: null })));
    const displayed = await getAllRounds("audit-session", labels.slice(0, courts)); db.done();
    expect(displayed).toHaveLength(robinWaveCount + 4);
    for (const r of displayed) for (const g of r.matches) {
      expect(g.courtLabel).toBe(`Court ${labels[g.courtNo! - 1]}`);
      const saved = db.rows<SavedMatch>(matches).find(x => x.id === g.id)!;
      expect([...g.teamA, ...g.teamB].map(p => p.id)).toEqual([saved.a1, saved.a2, saved.b1, saved.b2]);
    }
  });

  it("refuses to regenerate a stored draw and renders legacy saved players verbatim", async () => {
    const db = new MemoryWrites(); context.db = db;
    const teams = Array.from({ length: 4 }, (_, i) => ({ ...squad(i), women1: null, women2: null, men1: null, men2: null }));
    queueDraw(db, teams, 4, [{ id: "old-round" }]);
    await expect(createMlpScheduleAction("audit-session")).rejects.toThrow(makeT("en")("mlp.error.teamsLocked")); db.done();
    expect(db.writes).toHaveLength(0);
    const oldMatch = { id: "old-game", roundId: "old-round", courtNo: 4, mlpGame: "women", a1: teams[0].w1, a2: teams[0].w2,
      b1: teams[1].w1, b2: teams[1].w2, scoreA: 11, scoreB: 7, status: "completed", mlpTieId: "old-tie", enteredBy: "old-user", editedAt: null };
    db.queue(rounds, [{ id: "old-round", index: 73, stage: "robin" }]); db.queue(matches, [oldMatch]); db.queue(players, []);
    const shown = await getAllRounds("audit-session", labels.slice(0, 4)); db.done();
    expect(shown[0].index).toBe(73); expect(shown[0].matches[0].scoreA).toBe(11);
    expect(shown[0].matches[0].teamA.map(p => p.id)).toEqual([teams[0].w1, teams[0].w2]);
    db.queue(mlpTeams, teams); db.queue(mlpTies, [{ id: "old-tie", index: 19, block: 12, stage: "robin", teamAId: teams[0].id, teamBId: teams[1].id, tiebreakWinner: null }]);
    db.queue(matches, [oldMatch]); db.queue(players, []);
    const data = await getMlpData("audit-session"); db.done();
    expect(data.ties[0].block).toBe(12); expect(data.ties[0].games[0].scoreB).toBe(7);
    expect(data.canCorrectOpeningPairs).toBe(false); expect(db.writes).toHaveLength(0); expect(db.updates).toHaveLength(0);
  });
});

function form(courts: string[], format = "mlp", maxPlayers = 24) {
  const data = new FormData();
  for (const [k, v] of Object.entries({ sessionId: "audit-session", title: "Independent audit", startsAt: "2030-01-01T18:00:00Z",
    courtNames: courts.join(", "), format, maxPlayers: String(maxPlayers) })) data.set(k, v);
  return data;
}
function source(courts: number, count: number): CopyableSession {
  return { title: "Independent copy", location: null, startsAt: new Date("2026-01-01T18:00:00Z"), courtNames: labels.slice(0, courts),
    maxPlayers: count * 4, format: "mlp", notes: null, rated: false, isPrivate: false };
}

describe("court-label, create/edit/copy and UI boundaries", () => {
  it.each(combinations)("copy/create/edit preserve every label and capacity: $count / $courts", async ({ count, courts }) => {
    const original = source(courts, count), snapshot = structuredClone(original);
    const copy = copySourceFrom(original, false);
    expect(copy.courts.split(", ")).toEqual(labels.slice(0, courts)); expect(copy.maxPlayers).toBe(count * 4);
    expect(original).toEqual(snapshot);
    const db = new MemoryWrites(); context.db = db;
    const fd = form(copy.courts.split(", "), copy.format, copy.maxPlayers);
    // Exercise the same comma trimming and blank filtering as the actual form submit.
    fd.set("courtNames", ` , ${copy.courts}, , `);
    await expect(createSessionAction({}, fd)).rejects.toThrow(/^redirect:/);
    expect(db.rows<Row>(sessions)[0]).toMatchObject({ courtNames: original.courtNames, courtCount: courts, maxPlayers: count * 4 });
    db.queue(sessions, [{ status: "open" }]); db.queue(signups, [{ count: count * 4 }]);
    await expect(updateSessionAction({}, fd)).rejects.toThrow("redirect:/s/audit-session"); db.done();
    expect(db.updates[0].values).toMatchObject({ courtNames: original.courtNames, courtCount: courts, maxPlayers: count * 4 });
    const query = new PgDialect().sqlToQuery(db.updates[0].predicate);
    expect(query.sql).toContain('"sessions"."status"'); expect(query.params).toContain("open");
  });

  it("copies six-court legacy squads with explicit equivalent lineups and keeps the waitlist outside teams", async () => {
    const db = new MemoryWrites(); context.db = db;
    const legacy = Array.from({ length: 6 }, (_, i) => ({ ...squad(i), women1: null, women2: null, men1: null, men2: null }));
    const invited = [...rosterOf(legacy), "waiting-player"];
    const sourceId = "00000000-0000-4000-8000-000000000001";
    const fd = form(labels); fd.set("copyFrom", sourceId); invited.forEach(id => fd.append("invite", id));
    db.queue(sessions, [{ ...source(6, 6), createdBy: "audit-organizer" }]); db.queue(signups, []);
    db.queue(signups, invited.map((playerId, i) => ({ playerId, state: i < 24 ? "in" : "waitlist", waitlistPos: i < 24 ? null : 1, createdAt: new Date(i), partnerId: null })));
    db.queue(mlpTeams, legacy);
    await expect(createSessionAction({}, fd)).rejects.toThrow(/^redirect:/); db.done();
    const copied = db.rows<Team>(mlpTeams);
    expect(copied).toHaveLength(6);
    for (let i = 0; i < 6; i++) for (const k of kinds) expect(chosen(copied[i], k)).toEqual(chosen(legacy[i], k));
    expect(db.rows<Row>(signups).at(-1)).toMatchObject({ playerId: "waiting-player", state: "waitlist", waitlistPos: 1 });
    expect(db.rows<Row>(sessions)[0].courtNames).toEqual(labels);
  });

  const invalid = [
    { courts: labels.slice(0, 3), format: "mlp", capacity: 16, error: "mlp.error.setup" },
    { courts: [...labels, "seventh"], format: "mlp", capacity: 24, error: "err.maxCourts" },
    { courts: labels, format: "mlp", capacity: 28, error: "mlp.error.setup" },
    { courts: labels, format: "mlp", capacity: 23, error: "mlp.error.setup" },
    { courts: [...labels.slice(0, 4), " NORTH "], format: "mlp", capacity: 24, error: "err.courtsDistinct" },
    { courts: [...labels.slice(0, 4), "x".repeat(17)], format: "mlp", capacity: 24, error: "err.courtNameLong" },
    ...["regular", "balanced", "gender", "fixed", "custom"].map(format => ({ courts: labels.slice(0, 5), format, capacity: 24, error: "err.maxCourts" })),
  ];
  it.each(invalid)("server rejects $format / $capacity / $error in create and edit", async test => {
    const db = new MemoryWrites(); context.db = db;
    const fd = form(test.courts, test.format, test.capacity);
    const created = await createSessionAction({}, fd);
    db.queue(sessions, [{ status: "open" }]);
    if (test.error === "mlp.error.setup") db.queue(signups, [{ count: 0 }]);
    const edited = await updateSessionAction({}, fd); db.done();
    expect(created.error).toBeTruthy(); expect(edited.error).toBe(created.error);
    expect(db.writes).toHaveLength(0); expect(db.updates).toHaveLength(0);
  });

  it("a stale edit whose guarded UPDATE returns no rows reports started", async () => {
    const db = new MemoryWrites(); context.db = db; db.updateResult = [];
    db.queue(sessions, [{ status: "open" }]); db.queue(signups, [{ count: 24 }]);
    const result = await updateSessionAction({}, form(labels)); db.done();
    expect(result.error).toBe(makeT("en")("err.sessionStarted"));
    const compiled = new PgDialect().sqlToQuery(db.updates[0].predicate);
    expect(compiled.params).toEqual(["audit-session", "open"]);
  });

  it.each(["en", "zh-Hans", "zh-Hant"] as const)("renders fifth/sixth labels and copy/edit hints in %s", locale => {
    context.locale = locale; const t = makeT(locale);
    for (const courtNo of [5, 6]) expect(courtLabel(t, labels, courtNo)).toContain(labels[courtNo - 1]);
    expect(courtLabel(t, labels, null)).toBe(t("session.courtOne"));
    expect(courtLabel(t, labels.slice(0, 4), 6)).toBe(t("schedule.court", { name: 6 }));
    const hint = renderToStaticMarkup(createElement(MlpCourtHint, { teams: 6, courts: labels.slice(0, 5) }));
    expect(hint).toContain("Center &lt;5&gt;"); expect(hint).not.toContain("{court}");
    const copy = copySourceFrom(source(6, 6), false);
    const create = renderToStaticMarkup(createElement(SessionForm, { roster: [], copy }));
    expect(create).toContain('value="24"'); expect(create).toContain("1234567890123456");
    expect(create).toContain(t("form.courtsHint", { max: 6 }));
    const edit = renderToStaticMarkup(createElement(EditForm, { session: { id: "audit-session", title: copy.title, location: null,
      startsAtIso: copy.startsAt, courtNames: labels, maxPlayers: 24, format: "mlp", rated: false, notes: null, confirmed: 24 } }));
    expect(edit).toContain("1234567890123456"); expect(edit).toContain(t("form.courtsHint", { max: 6 }));
    expect(renderToStaticMarkup(createElement(MlpCourtHint, { teams: 4, courts: labels }))).toContain(t("mlp.spareCourtsHint"));
    expect(renderToStaticMarkup(createElement(MlpCourtHint, { teams: 6, courts: labels }))).toBe("");
  });

  it.each(["male", "female", "unspecified"])("setup accepts a homogeneous %s roster and shows all four saved pairs", gender => {
    const teams = Array.from({ length: 6 }, (_, i) => squad(i));
    const html = renderToStaticMarkup(createElement(MlpSetup, { sessionId: "audit-session", teams,
      roster: rosterOf(teams).map(id => ({ id, username: id, gender })), locked: false, live: true, teamCount: 6 }));
    expect(validateTeams(teams, new Set(rosterOf(teams)), 6)).toBe(true);
    for (const team of teams) for (const kind of kinds) for (const id of chosen(team, kind)) expect(html).toContain(`value="${id}"`);
    expect(html).toContain("Save teams and all four lineups");
  });
});

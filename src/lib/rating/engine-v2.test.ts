import { describe, expect, it } from "vitest";
import { RATING, TUNING_EPOCHS, tuningFor } from "./constants";
import { recompute, type MatchEvent, type SeedEvent } from "./engine";

/**
 * v2.0: a typed reliability fades, and a self re-seed may bring DUPR's
 * reliability along — capped where "reliable" starts.
 */

const DAY = 86_400_000;
const EPOCH = new Date("2026-10-23T00:00:00.000Z").getTime();
/** Comfortably inside the new epoch and before it. */
const NEW = new Date("2027-01-10T00:00:00.000Z").getTime();
const OLD = new Date("2026-10-01T00:00:00.000Z").getTime();

const seed = (
  playerId: string, rating: number, declared: number, atMs: number,
  opts: { isInitial?: boolean; selfInitiated?: boolean } = {},
): SeedEvent => ({
  kind: "seed", at: new Date(atMs), playerId, rating, declaredReliability: declared,
  isInitial: opts.isInitial ?? true, selfInitiated: opts.selfInitiated ?? true,
});
const match = (id: string, a: [string, string], b: [string, string], atMs: number, scoreA = 11, scoreB = 7): MatchEvent =>
  ({ kind: "match", at: new Date(atMs), matchId: id, teamA: a, teamB: b, scoreA, scoreB });

/** Eight players, `n` nights of four games each, partners rotating. */
function nights(n: number, firstMs: number, prefix = "m"): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (let night = 0; night < n; night++) {
    const at = firstMs + night * 7 * DAY;
    for (let g = 0; g < 4; g++) {
      const r = (i: number) => `p${(i + night + g) % 8}`;
      out.push(match(`${prefix}${night}-${g}`, [r(0), r(1 + g)], [r(2 + g), r(3 + g)], at + g * 60_000, 11, 5 + g));
    }
  }
  return out;
}
/** Everyone else's games, so the timeline ends when we say without touching the subject. */
const others = (atMs: number) => [seed("x1", 3, 0, atMs - DAY), seed("x2", 3, 0, atMs - DAY), seed("x3", 3, 0, atMs - DAY), seed("x4", 3, 0, atMs - DAY),
  match("tail", ["x1", "x2"], ["x3", "x4"], atMs)];

describe("epochs", () => {
  it("adds v2.0 after the last v1.4 match and keeps the floor permanent before it", () => {
    expect(TUNING_EPOCHS[0].from.getTime()).toBe(EPOCH);
    expect(tuningFor(new Date(EPOCH - 1)).DECLARED_FLOOR_HALF_LIFE_DAYS).toBeUndefined();
    expect(tuningFor(new Date(EPOCH)).DECLARED_FLOOR_HALF_LIFE_DAYS).toBe(90);
    // Everything else about the two tunings is the same.
    const before = tuningFor(new Date(EPOCH - 1)), after = tuningFor(new Date(EPOCH));
    for (const key of Object.keys(before) as Array<keyof typeof before>) expect(after[key], key).toEqual(before[key]);
  });
});

describe("a declared reliability floor fades (v2.0)", () => {
  it("halves every 90 days from the day it was typed", () => {
    // Seeded at 100% a year before the timeline ends: 0.5^(360/90) = 1/16.
    const result = recompute([seed("a", 4.0, 100, NEW - 360 * DAY), ...others(NEW)]);
    expect(result.players.get("a")!.reliability).toBeCloseTo(1 / 16, 6);
    expect(result.players.get("a")!.provisional).toBe(true);
  });

  it("was permanent before the epoch, so history replays unchanged", () => {
    const result = recompute([seed("a", 4.0, 100, OLD - 360 * DAY), ...others(OLD)]);
    expect(result.players.get("a")!.reliability).toBe(1);
    expect(result.players.get("a")!.provisional).toBe(false);
  });

  it("lets a stale 100% move again once the epoch starts", () => {
    const oldK = recompute([
      seed("a", 4.0, 100, OLD - 300 * DAY), seed("b", 4.0, 100, OLD - 300 * DAY),
      seed("c", 4.0, 0, OLD - 300 * DAY), seed("d", 4.0, 0, OLD - 300 * DAY),
      match("g", ["a", "b"], ["c", "d"], OLD),
    ]).changes.find((c) => c.playerId === "a")!.k;
    const newK = recompute([
      seed("a", 4.0, 100, NEW - 300 * DAY), seed("b", 4.0, 100, NEW - 300 * DAY),
      seed("c", 4.0, 0, NEW - 300 * DAY), seed("d", 4.0, 0, NEW - 300 * DAY),
      match("g", ["a", "b"], ["c", "d"], NEW),
    ]).changes.find((c) => c.playerId === "a")!.k;
    // Settled K before (volume tail), a near-new-player K after.
    expect(oldK).toBeLessThan(0.2);
    expect(newK).toBeGreaterThan(0.8);
  });

  it("is held up by play here, not by the typing", () => {
    // After 400 days the typed 100% is worth 0.05; what the player has is what
    // they played. Same timeline without the declaration gives the same answer.
    const typed = recompute([seed("p0", 4.0, 100, NEW - 400 * DAY), ...nights(12, NEW - 11 * 7 * DAY)]).players.get("p0")!;
    const earned = recompute([seed("p0", 4.0, 0, NEW - 400 * DAY), ...nights(12, NEW - 11 * 7 * DAY)]).players.get("p0")!;
    // Not bit-identical: the typed floor made p0 worth slightly more as
    // evidence to partners early on, which feeds back through their weights.
    expect(typed.reliability).toBeCloseTo(earned.reliability, 2);
    expect(typed.reliability).toBeGreaterThan(0.3);
  });
});

describe("a self re-seed with DUPR's reliability (v2.0)", () => {
  const established = () => [
    ...Array.from({ length: 8 }, (_, i) => seed(`p${i}`, 3.5, 0, NEW - 200 * DAY)),
    ...nights(3, NEW - 100 * DAY),
  ];

  it("with no reliability given still goes back to provisional with its books wiped", () => {
    const after = recompute([...established(), seed("p0", 4.6, 0, NEW - DAY, { isInitial: false }), ...others(NEW)]).players.get("p0")!;
    expect(after.rating).toBeCloseTo(4.6, 6);
    expect(after.reliability).toBe(0);
    expect(after.provisional).toBe(true);
  });

  it("with a reliability becomes a floor and keeps the evidence earned here", () => {
    const after = recompute([...established(), seed("p0", 4.6, 55, NEW - DAY, { isInitial: false }), ...others(NEW)]).players.get("p0")!;
    // 55% typed yesterday: 0.55 * 0.5^(1/90). Earned evidence from three nights is below that.
    expect(after.reliability).toBeCloseTo(0.55 * Math.pow(0.5, 1 / 90), 6);
    // Evidence kept: a later game is scored with the partner book intact.
    const later = recompute([...established(), seed("p0", 4.6, 55, NEW - 10 * DAY, { isInitial: false }),
      match("later", ["p0", "p1"], ["p2", "p3"], NEW)]).changes.find((c) => c.playerId === "p0" && c.matchId === "later")!;
    const wiped = recompute([...established(), seed("p0", 4.6, 0, NEW - 10 * DAY, { isInitial: false }),
      match("later", ["p0", "p1"], ["p2", "p3"], NEW)]).changes.find((c) => c.playerId === "p0" && c.matchId === "later")!;
    expect(later.reliabilityAtTime).toBeGreaterThan(wiped.reliabilityAtTime);
    expect(Math.abs(later.delta)).toBeLessThan(Math.abs(wiped.delta));
  });

  it("is capped at reliable, never settled, however high the number typed", () => {
    const after = recompute([...established(), seed("p0", 4.6, 100, NEW - DAY, { isInitial: false }), ...others(NEW)]).players.get("p0")!;
    expect(after.reliability).toBeCloseTo(RATING.RELIABILITY_PASS * Math.pow(0.5, 1 / 90), 6);
    expect(after.provisional).toBe(true); // a hair under 0.6 after one day of fading
  });

  it("leaves an admin correction free to set the full range", () => {
    const after = recompute([...established(), seed("p0", 4.6, 100, NEW - DAY, { isInitial: false, selfInitiated: false }), ...others(NEW)]).players.get("p0")!;
    expect(after.reliability).toBeCloseTo(Math.pow(0.5, 1 / 90), 6);
    expect(after.provisional).toBe(false);
  });
});

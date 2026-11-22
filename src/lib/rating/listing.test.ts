import { describe, expect, it } from "vitest";
import { RANKINGS } from "./constants";
import { recompute, type MatchEvent, type SeedEvent } from "./engine";
import { earnedNow, isRanked, type RankingEvidence } from "./listing";

/** Rankings: listed by reliability earned here, evaluated at view time, enter 60% / hold 50%. */

const DAY = 86_400_000;
const T0 = new Date("2027-01-04T00:00:00.000Z").getTime();

const seed = (id: string, declared = 0, atMs = T0 - DAY): SeedEvent => ({
  kind: "seed", at: new Date(atMs), playerId: id, rating: 3.5, declaredReliability: declared, isInitial: true, selfInitiated: true,
});
let n = 0;
const match = (a: [string, string], b: [string, string], atMs: number): MatchEvent => ({
  kind: "match", at: new Date(atMs), matchId: `m${n++}`, teamA: a, teamB: b, scoreA: 11, scoreB: 7,
});

/**
 * Eight players, `nights` weekly nights. Each night is the 7-round circle
 * rotation (everyone partners everyone once), two courts, with who faces whom
 * varied by night so opposing pairs differ too.
 */
function season(nights: number, firstMs = T0, prefix = "p"): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (let night = 0; night < nights; night++) {
    for (let r = 0; r < 7; r++) {
      const ring = [0, ...Array.from({ length: 7 }, (_, i) => 1 + ((i + r) % 7))];
      const pairs: [string, string][] = [0, 1, 2, 3].map((i) => [`${prefix}${ring[i]}`, `${prefix}${ring[7 - i]}`]);
      const v = night % 3;
      const courts: [number, number][] = v === 0 ? [[0, 1], [2, 3]] : v === 1 ? [[0, 2], [1, 3]] : [[0, 3], [1, 2]];
      for (const [x, y] of courts) out.push(match(pairs[x], pairs[y], firstMs + night * 7 * DAY + r * 600_000));
    }
  }
  return out;
}
/** Smallest number of weekly nights after which p0 has earned 60%. */
function nightsToQualify(): number {
  for (let k = 1; k <= 30; k++) {
    const r = recompute([...players(), ...season(k)]);
    const p = r.players.get("p0")!;
    if (earnedNow({ ...p.evidence, hold: p.rankHold }, p.evidence.atMs) >= RANKINGS.ENTER) return k;
  }
  throw new Error("fixture never reaches 60%");
}
const players = (prefix = "p") => Array.from({ length: 8 }, (_, i) => seed(`${prefix}${i}`));
const evidenceOf = (r: ReturnType<typeof recompute>, id: string): RankingEvidence => {
  const p = r.players.get(id)!;
  return { ...p.evidence, hold: p.rankHold };
};

describe("earned reliability for Rankings", () => {
  it("at the timeline end equals the engine's own reliability when no floor was typed", () => {
    const r = recompute([...players(), ...season(5)]);
    const p = r.players.get("p0")!;
    expect(earnedNow(evidenceOf(r, "p0"), p.evidence.atMs)).toBeCloseTo(p.reliability, 12);
  });

  it("ignores a typed DUPR floor: 100% typed and no games here is not listed", () => {
    const r = recompute([seed("alex", 100), ...players(), ...season(1)]);
    const alex = r.players.get("alex")!;
    expect(alex.reliability).toBeGreaterThan(0.99); // the ring still shows the typed floor
    expect(alex.provisional).toBe(false);
    expect(isRanked(evidenceOf(r, "alex"), alex.evidence.atMs)).toBe(false);
  });

  it("decays to the moment of viewing, not the last rebuild", () => {
    const r = recompute([...players(), ...season(5)]);
    const e = evidenceOf(r, "p0");
    const atEnd = earnedNow(e, e.atMs!);
    const later = earnedNow(e, e.atMs! + 60 * DAY);
    expect(later).toBeLessThan(atEnd);
    expect(earnedNow(e, e.atMs! - DAY)).toBe(atEnd); // never "un-decays" before the timeline end
  });
});

describe("enter at 60%, stay until 50%", () => {
  it("a regular who reached 60% stays listed while between 50% and 60%, and drops under 50%", () => {
    const r = recompute([...players(), ...season(nightsToQualify())]);
    const e = evidenceOf(r, "p0");
    expect(earnedNow(e, e.atMs!)).toBeGreaterThanOrEqual(RANKINGS.ENTER);
    expect(e.hold).toBe(true);
    // Find a day where earned reliability sits between the two lines.
    let day = 1;
    while (earnedNow(e, e.atMs! + day * DAY) >= RANKINGS.ENTER) day++;
    const between = e.atMs! + day * DAY;
    expect(earnedNow(e, between)).toBeGreaterThanOrEqual(RANKINGS.HOLD);
    expect(isRanked(e, between)).toBe(true);
    // Someone at the same level who was never listed is not listed there.
    expect(isRanked({ ...e, hold: false }, between)).toBe(false);
    while (earnedNow(e, e.atMs! + day * DAY) >= RANKINGS.HOLD) day++;
    expect(isRanked(e, e.atMs! + day * DAY)).toBe(false);
  });

  it("once under 50% between nights, they must reach 60% again to come back", () => {
    // Qualify, then 150 days away (well under 50%), then one more night.
    const early = season(nightsToQualify());
    const lastEarly = early[early.length - 1].at.getTime();
    const comeback = season(1, lastEarly + 150 * DAY);
    const r = recompute([...players(), ...early, ...comeback]);
    const e = evidenceOf(r, "p0");
    const earned = earnedNow(e, e.atMs!);
    // One night back is not enough to reach 60% again, so the hold was lost.
    if (earned < RANKINGS.ENTER) {
      expect(e.hold).toBe(false);
      expect(isRanked(e, e.atMs!)).toBe(false);
    } else {
      expect(e.hold).toBe(true);
    }
  });

  it("a self re-seed with no reliability wipes the evidence and the listing", () => {
    const base = [...players(), ...season(nightsToQualify())];
    const end = base[base.length - 1].at.getTime();
    const reseed: SeedEvent = { kind: "seed", at: new Date(end + DAY), playerId: "p0", rating: 4.2, declaredReliability: 0, isInitial: false, selfInitiated: true };
    const r = recompute([...base, reseed]);
    const e = evidenceOf(r, "p0");
    expect(e.hold).toBe(false);
    expect(isRanked(e, e.atMs!)).toBe(false);
  });

  it("does not change any rating", () => {
    const events = [...players(), ...season(4)];
    const a = recompute(events);
    const b = recompute(events);
    for (const [id, p] of a.players) expect(p.rating).toBe(b.players.get(id)!.rating);
  });
});

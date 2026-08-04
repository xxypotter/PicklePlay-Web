/**
 * The rating engine is the part of this product that has to be *right*, so the
 * spec's worked examples (SPEC.md §5.5) are asserted here literally. If someone
 * retunes a constant in constants.ts, these tests say exactly which documented
 * DUPR behavior they broke.
 */
import { describe, expect, it } from "vitest";
import { RATING } from "./constants";
import {
  compression,
  evidenceWeight,
  expectedShare,
  kFactor,
  matchSurprise,
  ratingDelta,
  recompute,

  type MatchEvent,
  type SeedEvent,
  type TimelineEvent,
} from "./engine";

/** An established player: reliability 1, well past the calibration window. */
const K_ESTABLISHED = RATING.K_RELIABLE;
/** Mid-scale rating, far enough from both bounds that compression is inert. */
const MID = 3.5;

const delta = (surprise: number, rating = MID) =>
  ratingDelta(rating, K_ESTABLISHED, surprise, false);

describe("expectation curves (§5.3 step 1)", () => {
  it("is a coin flip between equal teams", () => {
    expect(expectedShare(4, 4, RATING.D_POINTS)).toBeCloseTo(0.5, 10);
    expect(expectedShare(4, 4, RATING.D_WIN)).toBeCloseTo(0.5, 10);
  });

  it("calibrates a 1.00 gap to ~11-3 on points and ~90% on wins", () => {
    expect(expectedShare(4.5, 3.5, RATING.D_POINTS)).toBeCloseTo(0.788, 3);
    expect(expectedShare(4.5, 3.5, RATING.D_WIN)).toBeCloseTo(0.909, 3);
  });

  it("keeps the win curve steeper than the points curve at every gap", () => {
    for (const gap of [0.1, 0.25, 0.5, 1, 2]) {
      const points = expectedShare(4 + gap, 4, RATING.D_POINTS);
      const wins = expectedShare(4 + gap, 4, RATING.D_WIN);
      expect(wins).toBeGreaterThan(points);
    }
  });
});

describe("worked examples (§5.5)", () => {
  it("even teams, win 11-9 → +0.021", () => {
    const s = matchSurprise(MID, MID, 11, 9);
    expect(s).toBeCloseTo(0.3425, 4);
    expect(delta(s)).toBeCloseTo(0.021, 3);
  });

  it("even teams, win 11-0 → +0.030", () => {
    const s = matchSurprise(MID, MID, 11, 0);
    expect(s).toBeCloseTo(0.5, 4);
    expect(delta(s)).toBeCloseTo(0.03, 3);
  });

  it("underdog by 1.00, wins 11-9 → +0.043", () => {
    const s = matchSurprise(3.5, 4.5, 11, 9);
    expect(s).toBeCloseTo(0.7094, 4);
    expect(delta(s)).toBeCloseTo(0.043, 3);
  });

  it("favorite by 1.00, wins 11-2 → +0.005", () => {
    const s = matchSurprise(4.5, 3.5, 11, 2);
    expect(s).toBeCloseTo(0.0793, 4);
    expect(delta(s, 4.5)).toBeCloseTo(0.005, 3);
  });

  it("favorite by 1.00, wins 11-9 → -0.001 (down in a win)", () => {
    const s = matchSurprise(4.5, 3.5, 11, 9);
    expect(s).toBeLessThan(0);
    expect(delta(s, 4.5)).toBeCloseTo(-0.001, 3);
  });

  it("underdog by 1.00, loses 9-11 → +0.001 (up in a loss)", () => {
    const s = matchSurprise(3.5, 4.5, 9, 11);
    expect(s).toBeGreaterThan(0);
    expect(delta(s)).toBeCloseTo(0.001, 3);
  });
});

describe("documented DUPR behaviors (§5.1)", () => {
  it("#1 rewards beating a stronger opponent far more than a weaker one", () => {
    const upset = matchSurprise(3.5, 4.5, 11, 9);
    const expected = matchSurprise(4.5, 3.5, 11, 9);
    expect(upset).toBeGreaterThan(Math.abs(expected) * 10);
  });

  it("#4 lets margin matter, but only a little", () => {
    const blowout = delta(matchSurprise(MID, MID, 11, 0));
    const squeaker = delta(matchSurprise(MID, MID, 11, 9));
    const marginEffect = blowout - squeaker;
    expect(marginEffect).toBeGreaterThan(0);
    // Margin is worth well under half of what winning at all is worth.
    expect(marginEffect).toBeLessThan(squeaker * 0.5);
  });

  it("#5 moves a brand-new player far faster than an established one", () => {
    const s = matchSurprise(MID, MID, 11, 9);
    const rookie = ratingDelta(MID, kFactor(0, 0), s, true);
    const veteran = ratingDelta(MID, kFactor(1, 50), s, false);
    expect(rookie).toBeGreaterThan(veteran * 5);
  });

  it("#6 compresses movement near the ceiling and the floor", () => {
    expect(compression(MID, true)).toBe(1);
    expect(compression(7.5, true)).toBeLessThan(1);
    expect(compression(2.5, false)).toBeLessThan(1);
    // Gaining near the floor is unimpeded; only the approached bound compresses.
    expect(compression(2.5, true)).toBe(1);
  });

  it("#7 halves the weight of a result every 90 days", () => {
    expect(3 * evidenceWeight(0)).toBeCloseTo(3, 10);
    expect(6 * evidenceWeight(90)).toBeCloseTo(3, 10);
    expect(12 * evidenceWeight(180)).toBeCloseTo(3, 10);
  });

  it("#8 moves both partners the same direction by different amounts", () => {
    const now = Date.now();
    // p1 has a real match history here; the rookie has nothing but a seed.
    const events = roundRobin(now);
    events.push(seed("rookie", 3.8, 0, now - day(1)));
    events.push(match("final", ["p1", "rookie"], ["p3", "p4"], 11, 9, now));

    const { changes } = recompute(events);
    const vet = changes.find((c) => c.matchId === "final" && c.playerId === "p1")!;
    const rook = changes.find((c) => c.matchId === "final" && c.playerId === "rookie")!;

    expect(Math.sign(vet.delta)).toBe(Math.sign(rook.delta));
    expect(Math.abs(rook.delta)).toBeGreaterThan(Math.abs(vet.delta));
  });
});

describe("K factor and the seed floor (§5.3, §5.7)", () => {
  it("falls monotonically as reliability rises", () => {
    const ks = [0, 0.25, 0.5, 0.75, 1].map((r) => kFactor(r, 50));
    for (let i = 1; i < ks.length; i++) expect(ks[i]).toBeLessThan(ks[i - 1]);
  });

  it("bottoms out at K_RELIABLE for a fully established player", () => {
    expect(kFactor(1, 50)).toBeCloseTo(RATING.K_RELIABLE, 10);
  });

  it("floors K until the player has 5 local matches, however reliable they claim to be", () => {
    expect(kFactor(1, 0)).toBeGreaterThanOrEqual(RATING.K_SEED_FLOOR);
    expect(kFactor(1, 4)).toBeGreaterThanOrEqual(RATING.K_SEED_FLOOR);
    expect(kFactor(1, 5)).toBeLessThan(RATING.K_SEED_FLOOR);
  });

});

describe("a self-declared rating is not evidence (§5.7)", () => {
  const now = Date.now();

  it("leaves a seeded player who has never played fully unreliable", () => {
    // The bug this replaced: declaring 100% reliability bought 8 half-lives
    // and 8 opponents, which computed to 88% — past the 60% threshold — so a
    // player who had never hit a ball was treated as settled.
    const { players } = recompute([seed("p1", 4.3, 100, now - day(1))]);
    const p = players.get("p1")!;
    expect(p.rating).toBeCloseTo(4.3, 6);
    expect(p.reliability).toBe(0);
    expect(p.provisional).toBe(true);
  });

  it("does not reward an ambitious claim over a conservative one", () => {
    const bold = recompute([seed("p1", 4.3, 100, now - day(1))]).players.get("p1")!;
    const shy = recompute([seed("p2", 4.3, 5, now - day(1))]).players.get("p2")!;
    expect(bold.reliability).toBe(shy.reliability);
    expect(bold.provisional).toBe(shy.provisional);
  });

  it("still anchors where the player starts", () => {
    const high = recompute([seed("p1", 5.0, 0, now - day(1))]).players.get("p1")!;
    const low = recompute([seed("p2", 2.5, 0, now - day(1))]).players.get("p2")!;
    expect(high.rating).toBeGreaterThan(low.rating);
  });

  it("earns reliability only by playing", () => {
    const events = [
      seed("p1", 3.5, 100, now - day(30)),
      seed("p2", 3.5, 100, now - day(30)),
      seed("p3", 3.5, 100, now - day(30)),
      seed("p4", 3.5, 100, now - day(30)),
      match("m1", ["p1", "p2"], ["p3", "p4"], 11, 7, now - day(2)),
    ];
    const p1 = recompute(events).players.get("p1")!;
    // One match against three opponents: real but nowhere near settled.
    expect(p1.reliability).toBeGreaterThan(0);
    expect(p1.reliability).toBeLessThan(RATING.RELIABILITY_PASS);
    expect(p1.provisional).toBe(true);
  });
});

describe("whole-history recompute (§5.6)", () => {
  const now = Date.now();

  it("is deterministic", () => {
    const events = roundRobin(now);
    const a = recompute(events);
    const b = recompute(events);
    for (const [id, p] of a.players) {
      expect(p.rating).toBeCloseTo(b.players.get(id)!.rating, 12);
    }
  });

  it("does not depend on the order events are supplied in", () => {
    const events = roundRobin(now);
    const shuffled = [...events].reverse();
    const a = recompute(events);
    const b = recompute(shuffled);
    for (const [id, p] of a.players) {
      expect(p.rating).toBeCloseTo(b.players.get(id)!.rating, 12);
    }
  });

  it("keeps every rating inside the scale", () => {
    // 60 straight blowout wins for one pair is the most extreme pressure the
    // scale will ever see; it must not escape the bounds.
    const events: TimelineEvent[] = [
      seed("a", 7.9, 100, now - day(500)),
      seed("b", 7.9, 100, now - day(500)),
      seed("c", 2.1, 100, now - day(500)),
      seed("d", 2.1, 100, now - day(500)),
    ];
    for (let i = 0; i < 60; i++) {
      events.push(match(`m${i}`, ["a", "b"], ["c", "d"], 11, 0, now - day(60 - i)));
    }
    for (const p of recompute(events).players.values()) {
      expect(p.rating).toBeGreaterThanOrEqual(RATING.MIN);
      expect(p.rating).toBeLessThanOrEqual(RATING.MAX);
    }
  });

  it("is zero-sum between evenly matched sides", () => {
    // Four players in identical states move by equal and opposite amounts, so
    // no rating is created or destroyed by playing a match.
    const events: TimelineEvent[] = [
      seed("a", 4, 60, now - day(2)),
      seed("b", 4, 60, now - day(2)),
      seed("c", 4, 60, now - day(2)),
      seed("d", 4, 60, now - day(2)),
      match("m1", ["a", "b"], ["c", "d"], 11, 6, now),
    ];
    const total = recompute(events).changes.reduce((sum, c) => sum + c.delta, 0);
    expect(total).toBeCloseTo(0, 10);
  });

  it("applies a re-seed as a dated event in history, not an overwrite (§5.8)", () => {
    const base: TimelineEvent[] = [
      seed("x", 3.0, 50, now - day(200)),
      seed("y", 4.5, 100, now - day(200)),
      seed("z", 4.5, 100, now - day(200)),
      seed("w", 4.5, 100, now - day(200)),
    ];
    for (let i = 0; i < 12; i++) {
      base.push(match(`m${i}`, ["x", "y"], ["z", "w"], 11, 3, now - day(150 - i * 10)));
    }

    const withReseed: TimelineEvent[] = [
      ...base,
      { ...seed("x", 3.2, 80, now - day(5)), isInitial: false },
    ];

    const after = recompute(withReseed).players.get("x")!;
    // The re-seed lands 5 days before the end with no matches after it, so the
    // declared value must survive intact.
    expect(after.rating).toBeCloseTo(3.2, 10);
  });

  it("tracks W/L, points, and streak", () => {
    const events: TimelineEvent[] = [
      seed("a", 4, 0, now - day(30)),
      seed("b", 4, 0, now - day(30)),
      seed("c", 4, 0, now - day(30)),
      seed("d", 4, 0, now - day(30)),
      match("m1", ["a", "b"], ["c", "d"], 11, 5, now - day(3)),
      match("m2", ["a", "b"], ["c", "d"], 11, 7, now - day(2)),
      match("m3", ["a", "b"], ["c", "d"], 4, 11, now - day(1)),
    ];
    const a = recompute(events).players.get("a")!;
    expect(a.wins).toBe(2);
    expect(a.losses).toBe(1);
    expect(a.localMatches).toBe(3);
    expect(a.pointsFor).toBe(26);
    expect(a.pointsAgainst).toBe(23);
    expect(a.streak).toBe(-1);
  });

  it("marks a thin record provisional and self-declared", () => {
    const events: TimelineEvent[] = [
      seed("a", 3.5, 0, now - day(10)),
      seed("b", 3.5, 0, now - day(10)),
      seed("c", 3.5, 0, now - day(10)),
      seed("d", 3.5, 0, now - day(10)),
      match("m1", ["a", "b"], ["c", "d"], 11, 9, now - day(1)),
    ];
    const a = recompute(events).players.get("a")!;
    expect(a.provisional).toBe(true);
    expect(a.selfDeclared).toBe(true);
    expect(a.localMatches).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const day = (n: number) => n * 86_400_000;

function seed(
  playerId: string,
  rating: number,
  declaredReliability: number,
  atMs: number,
): SeedEvent {
  return {
    kind: "seed",
    at: new Date(atMs),
    playerId,
    rating,
    declaredReliability,
    isInitial: true,
  };
}

function match(
  matchId: string,
  teamA: [string, string],
  teamB: [string, string],
  scoreA: number,
  scoreB: number,
  atMs: number,
): MatchEvent {
  return { kind: "match", at: new Date(atMs), matchId, teamA, teamB, scoreA, scoreB };
}

/** Eight players, every result a different scoreline — a realistic club night. */
function roundRobin(now: number): TimelineEvent[] {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const events: TimelineEvent[] = ids.map((id, i) =>
    seed(id, 3.0 + i * 0.2, (i % 5) * 25, now - day(120)),
  );
  let n = 0;
  for (let round = 0; round < 10; round++) {
    for (let court = 0; court < 2; court++) {
      const o = (round + court * 4) % 8;
      const pick = (k: number) => ids[(o + k) % 8];
      events.push(
        match(
          `m${n}`,
          [pick(0), pick(1)],
          [pick(2), pick(3)],
          11,
          (n * 3) % 11,
          now - day(100 - round * 8),
        ),
      );
      n++;
    }
  }
  return events;
}

import { describe, expect, it } from "vitest";
import {
  applyRound,
  emptyHistory,
  generateRound,
  pairKey,
  type GenPlayer,
} from "./generator";
import { planCasualRounds, planRegularRounds, splitsEvenly } from "./plan";

/** Deterministic PRNG so these assertions are exact, not flaky. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playFullSession(
  playerCount: number,
  courts: number,
  roundCount: number,
  seed: number,
) {
  const players: GenPlayer[] = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`,
    rating: 3.0 + (i % 5) * 0.25,
  }));
  const random = mulberry32(seed);
  let history = emptyHistory();
  for (let r = 0; r < roundCount; r++) {
    history = applyRound(
      history,
      generateRound(players, courts, history, { format: "regular", restarts: 200, random }),
    );
  }

  const games = players.map((p) => history.gamesPlayed[p.id] ?? 0);
  const byes = players.map((p) => history.sitOuts[p.id] ?? 0);
  const pairs: number[] = [];
  for (let i = 0; i < playerCount; i++) {
    for (let j = i + 1; j < playerCount; j++) {
      pairs.push(history.partnerCounts[pairKey(`p${i}`, `p${j}`)] ?? 0);
    }
  }
  return { games, byes, pairs };
}

describe("splitsEvenly", () => {
  it("rejects the 9-player, 8-round case that produced a lopsided night", () => {
    // 8 rounds x 8 seats = 64 slots; 64/9 is not whole, so one player must
    // play an extra game no matter how well the generator schedules.
    expect(splitsEvenly(9, 2, 8)).toBe(false);
  });

  it("accepts 9 rounds for 9 players", () => {
    expect(splitsEvenly(9, 2, 9)).toBe(true);
  });

  it("is unbothered when everyone plays every round", () => {
    // 8 players on 2 courts seats everybody, so any length splits evenly.
    for (let r = 1; r <= 10; r++) expect(splitsEvenly(8, 2, r)).toBe(true);
  });
});

describe("planRegularRounds", () => {
  it("suggests 9 rounds for 9 players on 2 courts", () => {
    expect(planRegularRounds(9, 2)).toEqual({
      rounds: 9,
      gamesEach: 8,
      fullCoverage: true,
    });
  });

  it("completes the round robin when the numbers allow it", () => {
    expect(planRegularRounds(8, 2)).toEqual({ rounds: 7, gamesEach: 7, fullCoverage: true });
    expect(planRegularRounds(12, 3)).toEqual({
      rounds: 11,
      gamesEach: 11,
      fullCoverage: true,
    });
    expect(planRegularRounds(13, 3)).toEqual({
      rounds: 13,
      gamesEach: 12,
      fullCoverage: true,
    });
  });

  it("falls back to an even split when full coverage is impossible", () => {
    // 10 players on 2 courts needs 11.25 rounds for full coverage — not a
    // whole number, so the best available promise is an even split.
    const plan = planRegularRounds(10, 2);
    expect(plan).not.toBeNull();
    expect(plan!.fullCoverage).toBe(false);
    expect(splitsEvenly(10, 2, plan!.rounds)).toBe(true);
    expect(Number.isInteger(plan!.gamesEach)).toBe(true);
  });

  it("always returns a plan that splits evenly, 8..16 players", () => {
    for (let n = 8; n <= 16; n++) {
      const courts = Math.min(4, Math.floor(n / 4));
      const plan = planRegularRounds(n, courts);
      expect(plan, `n=${n}`).not.toBeNull();
      expect(splitsEvenly(n, courts, plan!.rounds), `n=${n}`).toBe(true);
    }
  });

  it("returns null when there aren't enough players for a court", () => {
    expect(planRegularRounds(3, 2)).toBeNull();
  });
});

describe("regular round robin, end to end", () => {
  it("gives 9 players an even night at the planned length", () => {
    const plan = planRegularRounds(9, 2)!;
    // Several seeds: evenness must not depend on luck.
    for (let seed = 1; seed <= 8; seed++) {
      const { games, byes } = playFullSession(9, 2, plan.rounds, seed);
      expect(new Set(games), `seed ${seed} games`).toEqual(new Set([8]));
      expect(new Set(byes), `seed ${seed} byes`).toEqual(new Set([1]));
    }
  });

  it("covers nearly every partnership at the planned length", () => {
    const plan = planRegularRounds(9, 2)!;
    let missing = 0;
    const seeds = 20;
    for (let seed = 1; seed <= seeds; seed++) {
      const { pairs } = playFullSession(9, 2, plan.rounds, seed);
      missing += pairs.filter((c) => c === 0).length;
    }
    // 36 pairs per session. Greedy round-by-round search misses a fraction of
    // one pair per session on average; it is not a perfect combinatorial
    // design and doesn't claim to be.
    expect(missing / seeds).toBeLessThan(1);
  });

  it("still spreads games as evenly as possible at a length that can't be even", () => {
    // The reported session: 8 rounds, 9 players. Best possible is one player
    // on 8 games and everyone else on 7 — which is what we produce.
    const { games, byes } = playFullSession(9, 2, 8, 1);
    expect(games.filter((g) => g === 8)).toHaveLength(1);
    expect(games.filter((g) => g === 7)).toHaveLength(8);
    expect(byes.filter((b) => b === 0)).toHaveLength(1);
    expect(games.reduce((a, b) => a + b, 0)).toBe(64);
  });
});

describe("planCasualRounds", () => {
  it("keeps the old rule of thumb for non-round-robin formats", () => {
    expect(planCasualRounds(9, 2)).toBe(7);
    expect(planCasualRounds(8, 2)).toBe(6);
  });
});

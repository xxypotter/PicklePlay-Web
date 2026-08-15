import { describe, expect, it } from "vitest";
import {
  perfectSchedulePossible,
  planFixedPartnerRounds,
  planPerfectSchedule,
  seatsUsed,
  type PlannedPairRound,
  type PlannedRound,
} from "./schedule";

/** Deterministic generator so a failure is reproducible rather than a mood. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const pairKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function partnerships(schedule: PlannedRound[]): string[] {
  return schedule.flatMap((round) =>
    round.flatMap(([a1, a2, b1, b2]) => [pairKey(a1, a2), pairKey(b1, b2)]),
  );
}

function gamesPerPlayer(schedule: PlannedRound[], playerCount: number): number[] {
  const games = new Array(playerCount).fill(0);
  for (const round of schedule) {
    for (const seats of round) for (const p of seats) games[p]++;
  }
  return games;
}

describe("seatsUsed", () => {
  it("fills whole courts only", () => {
    expect(seatsUsed(9, 2)).toBe(8);
    expect(seatsUsed(7, 2)).toBe(4);
    expect(seatsUsed(16, 3)).toBe(12);
    expect(seatsUsed(3, 2)).toBe(0);
  });
});

describe("perfectSchedulePossible", () => {
  it("accepts a nine-player, nine-round session — 36 pairs, 36 available", () => {
    expect(perfectSchedulePossible(9, 2, 9)).toBe(true);
  });

  it("rejects a tenth round, which would need a 37th partnership", () => {
    expect(perfectSchedulePossible(9, 2, 10)).toBe(false);
  });

  it("rejects a session with no full court", () => {
    expect(perfectSchedulePossible(3, 2, 4)).toBe(false);
  });
});

describe("planPerfectSchedule", () => {
  it("gives nine players nine rounds with no repeated partnership", () => {
    // The exact case that failed in production: Sunday's session produced 34
    // distinct pairs, repeating Charles+Sam and Daniel+Yang.
    const schedule = planPerfectSchedule(9, 2, 9, { random: seeded(1) });
    expect(schedule).not.toBeNull();

    const pairs = partnerships(schedule!);
    expect(pairs).toHaveLength(36);
    expect(new Set(pairs).size).toBe(36);
  });

  it("covers every possible partnership exactly once at nine players", () => {
    const schedule = planPerfectSchedule(9, 2, 9, { random: seeded(7) })!;
    const seen = new Set(partnerships(schedule));
    for (let a = 0; a < 9; a++) {
      for (let b = a + 1; b < 9; b++) {
        expect(seen.has(pairKey(a, b))).toBe(true);
      }
    }
  });

  it("gives everyone the same number of games", () => {
    const schedule = planPerfectSchedule(9, 2, 9, { random: seeded(3) })!;
    expect(new Set(gamesPerPlayer(schedule, 9))).toEqual(new Set([8]));
  });

  it("never puts a player on two courts in the same round", () => {
    const schedule = planPerfectSchedule(9, 2, 9, { random: seeded(11) })!;
    for (const round of schedule) {
      const onCourt = round.flat();
      expect(new Set(onCourt).size).toBe(onCourt.length);
    }
  });

  it("rests each player exactly once over nine rounds", () => {
    const schedule = planPerfectSchedule(9, 2, 9, { random: seeded(5) })!;
    const rests = new Array(9).fill(0);
    for (const round of schedule) {
      const playing = new Set(round.flat());
      for (let p = 0; p < 9; p++) if (!playing.has(p)) rests[p]++;
    }
    expect(rests).toEqual(new Array(9).fill(1));
  });

  it("solves the eight-player whist tournament: seven rounds, every pair once", () => {
    const schedule = planPerfectSchedule(8, 2, 7, { random: seeded(2) });
    expect(schedule).not.toBeNull();
    const pairs = partnerships(schedule!);
    expect(new Set(pairs).size).toBe(28);
    expect(gamesPerPlayer(schedule!, 8)).toEqual(new Array(8).fill(7));
  });

  it("handles twelve players on three courts", () => {
    const schedule = planPerfectSchedule(12, 3, 5, { random: seeded(4) });
    expect(schedule).not.toBeNull();
    const pairs = partnerships(schedule!);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(schedule![0]).toHaveLength(3);
  });

  it("returns null rather than a flawed schedule when one cannot exist", () => {
    expect(planPerfectSchedule(9, 2, 10, { random: seeded(1) })).toBeNull();
  });

  it("is deterministic for a given seed", () => {
    const a = planPerfectSchedule(9, 2, 9, { random: seeded(42) });
    const b = planPerfectSchedule(9, 2, 9, { random: seeded(42) });
    expect(a).toEqual(b);
  });

  it("succeeds across many seeds, so a real session isn't a coin flip", () => {
    let solved = 0;
    for (let seed = 1; seed <= 40; seed++) {
      if (planPerfectSchedule(9, 2, 9, { random: seeded(seed) })) solved++;
    }
    expect(solved).toBe(40);
  });
});

describe("planFixedPartnerRounds", () => {
  const flat = (s: PlannedPairRound[]) => s.flat();

  it("gives every pair the same number of games when they all fit", () => {
    // 4 pairs, 2 courts: everyone plays every round.
    const schedule = planFixedPartnerRounds(4, 2, 6, { random: seeded(1) })!;
    const games = new Array(4).fill(0);
    for (const [a, b] of flat(schedule)) {
      games[a]++;
      games[b]++;
    }
    expect(new Set(games)).toEqual(new Set([6]));
  });

  it("never puts a pair on two courts in the same round", () => {
    const schedule = planFixedPartnerRounds(6, 3, 8, { random: seeded(2) })!;
    for (const round of schedule) {
      const seated = round.flat();
      expect(new Set(seated).size).toBe(seated.length);
    }
  });

  it("spends every fresh matchup before repeating one", () => {
    // 4 pairs have 6 possible opponents pairings; over 3 rounds of 2 courts
    // that is exactly 6 matches, so none should repeat.
    const schedule = planFixedPartnerRounds(4, 2, 3, { random: seeded(3) })!;
    const seen = flat(schedule).map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`));
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("keeps court time even when more pairs than courts turn up", () => {
    // 5 pairs, 2 courts: one pair rests each round.
    const schedule = planFixedPartnerRounds(5, 2, 10, { random: seeded(4) })!;
    const games = new Array(5).fill(0);
    for (const [a, b] of flat(schedule)) {
      games[a]++;
      games[b]++;
    }
    expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(1);
  });

  it("keeps going past the point where fresh matchups run out", () => {
    // Unlike the perfect-schedule search, this must not give up: a long
    // fixed-partner night simply replays opponents.
    const schedule = planFixedPartnerRounds(4, 2, 12, { random: seeded(5) });
    expect(schedule).not.toBeNull();
    expect(schedule).toHaveLength(12);
  });

  it("refuses a shape that cannot produce a match", () => {
    expect(planFixedPartnerRounds(1, 2, 4, { random: seeded(1) })).toBeNull();
    expect(planFixedPartnerRounds(4, 0, 4, { random: seeded(1) })).toBeNull();
  });

  it("is deterministic for a given seed", () => {
    const a = planFixedPartnerRounds(6, 2, 5, { random: seeded(9) });
    const b = planFixedPartnerRounds(6, 2, 5, { random: seeded(9) });
    expect(a).toEqual(b);
  });
});

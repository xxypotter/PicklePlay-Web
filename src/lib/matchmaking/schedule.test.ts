import { describe, expect, it } from "vitest";
import {
  perfectSchedulePossible,
  planPerfectSchedule,
  seatsUsed,
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

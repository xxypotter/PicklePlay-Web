import { describe, expect, it } from "vitest";
import {
  applyRound,
  emptyHistory,
  generateRound,
  WEIGHTS,
  type GenPlayer,
} from "./generator";
import { countViolations, matchViolates, type Gender } from "./gender";
import { planPerfectSchedule, type PlannedRound } from "./schedule";

/** Deterministic PRNG, so a failure is reproducible rather than a bad night. */
function mulberry(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const roster = (males: number, females: number, unspecified = 0): Gender[] => [
  ...Array<Gender>(males).fill("male"),
  ...Array<Gender>(females).fill("female"),
  ...Array<Gender>(unspecified).fill("unspecified"),
];

/** Distinct partnerships in a plan, and how many of them happen twice. */
function partnerships(plan: PlannedRound[]) {
  const seen = new Map<string, number>();
  for (const round of plan) {
    for (const [a1, a2, b1, b2] of round) {
      for (const [x, y] of [
        [a1, a2],
        [b1, b2],
      ]) {
        const k = [x, y].sort((p, q) => p - q).join("|");
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
  }
  return { distinct: seen.size, repeated: [...seen.values()].filter((n) => n > 1).length };
}

describe("matchViolates", () => {
  it("rejects two men against two women, in both directions", () => {
    expect(matchViolates("male", "male", "female", "female")).toBe(true);
    expect(matchViolates("female", "female", "male", "male")).toBe(true);
  });

  it("allows same-gender teams facing each other", () => {
    // The rule is about the matchup, not the team: an all-male court is fine.
    expect(matchViolates("male", "male", "male", "male")).toBe(false);
    expect(matchViolates("female", "female", "female", "female")).toBe(false);
  });

  it("allows anything with a mixed team", () => {
    expect(matchViolates("male", "female", "male", "female")).toBe(false);
    expect(matchViolates("male", "male", "male", "female")).toBe(false);
    expect(matchViolates("female", "female", "male", "female")).toBe(false);
  });

  it("never blames a player who didn't state a gender", () => {
    // "unspecified" also means "not listed in rankings", so it is a real
    // choice and must not be guessed at in either direction.
    expect(matchViolates("male", "unspecified", "female", "female")).toBe(false);
    expect(matchViolates("male", "male", "female", "unspecified")).toBe(false);
    expect(matchViolates("unspecified", "unspecified", "unspecified", "unspecified")).toBe(
      false,
    );
  });
});

describe("planPerfectSchedule with genders", () => {
  /*
   * The shapes this group actually turns up in. The roster skews male, so the
   * cases that matter run from a near-even split down to a couple of women in
   * a field of twelve.
   */
  const shapes: Array<[string, number, number, number, number]> = [
    ["8 players, 4M/4F, 2 courts", 4, 4, 2, 7],
    ["9 players, 6M/3F, 2 courts", 6, 3, 2, 8],
    ["12 players, 8M/4F, 3 courts", 8, 4, 3, 8],
    ["12 players, 10M/2F, 3 courts", 10, 2, 3, 8],
    ["12 players, 6M/6F, 3 courts", 6, 6, 3, 11],
    ["16 players, 12M/4F, 4 courts", 12, 4, 4, 8],
    ["10 players, 5M/5F, 2 courts", 5, 5, 2, 9],
    ["20 players, 15M/5F, 4 courts", 15, 5, 4, 9],
  ];

  for (const [label, m, w, courts, rounds] of shapes) {
    it(`never puts two men against two women — ${label}`, () => {
      const genders = roster(m, w);
      const plan = planPerfectSchedule(m + w, courts, rounds, {
        random: mulberry(42),
        genders,
      });

      expect(plan).not.toBeNull();
      expect(countViolations(plan!, genders)).toBe(0);
    });
  }

  it("keeps the partner rotation the regular round robin promises", () => {
    // The whole design rests on this: the gender rule is paid for out of who
    // faces whom, never out of who partners whom. Twelve players over eight
    // rounds on three courts is 48 partnerships, and all 48 must be distinct.
    const genders = roster(8, 4);
    const plan = planPerfectSchedule(12, 3, 8, { random: mulberry(7), genders });

    expect(plan).not.toBeNull();
    expect(partnerships(plan!)).toEqual({ distinct: 48, repeated: 0 });
    expect(countViolations(plan!, genders)).toBe(0);
  });

  it("matches the regular round robin's partner coverage exactly", () => {
    const genders = roster(6, 6);
    const plain = planPerfectSchedule(12, 3, 11, { random: mulberry(3) });
    const gendered = planPerfectSchedule(12, 3, 11, { random: mulberry(3), genders });

    // Both are full round robins: 66 partnerships, none repeated. Adding the
    // gender rule costs nothing on the promise the format is named for.
    expect(partnerships(plain!)).toEqual({ distinct: 66, repeated: 0 });
    expect(partnerships(gendered!)).toEqual({ distinct: 66, repeated: 0 });
  });

  it("gets as close as the arithmetic allows when zero is impossible", () => {
    /*
     * Ten men and two women over a full round robin cannot be clean. The two
     * women partner each other exactly once, and every pair left to face them
     * is two men. One violation in thirty-three matches is the true minimum,
     * not a search that gave up — so this asserts the floor, and would catch a
     * regression that started throwing or returning nothing instead.
     */
    const genders = roster(10, 2);
    const plan = planPerfectSchedule(12, 3, 11, { random: mulberry(11), genders });

    expect(plan).not.toBeNull();
    expect(countViolations(plan!, genders)).toBe(1);
    expect(partnerships(plan!)).toEqual({ distinct: 66, repeated: 0 });
  });

  it("balances the matchups without spending either higher priority", () => {
    /*
     * The real 8M/2F roster of 2026-08-30, with the ratings they carried into
     * it — the night that produced seven blowouts in twenty and prompted this.
     * Balance is third: it must improve, and it must cost the gender rule and
     * partner rotation nothing at all.
     */
    const roster: Array<[Gender, number]> = [
      ["male", 3.629],
      ["male", 2.9],
      ["male", 3.559],
      ["male", 3.872],
      ["male", 2.855],
      ["male", 2.5],
      ["male", 2.858],
      ["female", 3.043],
      ["female", 2.667],
      ["male", 3.55],
    ];
    const genders = roster.map(([g]) => g);
    const ratings = roster.map(([, r]) => r);

    const meanGap = (plan: PlannedRound[]) => {
      const gaps = plan.flatMap((round) =>
        round.map(([a1, a2, b1, b2]) =>
          Math.abs((ratings[a1] + ratings[a2]) / 2 - (ratings[b1] + ratings[b2]) / 2),
        ),
      );
      return gaps.reduce((x, y) => x + y, 0) / gaps.length;
    };

    let blind = 0;
    let balanced = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const a = planPerfectSchedule(10, 2, 10, { genders, random: mulberry(seed) })!;
      const b = planPerfectSchedule(10, 2, 10, {
        genders,
        ratings,
        random: mulberry(seed),
      })!;

      // Neither higher priority may be spent to get there.
      expect(countViolations(a, genders)).toBe(0);
      expect(countViolations(b, genders)).toBe(0);
      expect(partnerships(a)).toEqual({ distinct: 40, repeated: 0 });
      expect(partnerships(b)).toEqual({ distinct: 40, repeated: 0 });

      blind += meanGap(a);
      balanced += meanGap(b);
    }

    expect(balanced / 8).toBeLessThan(blind / 8);
    // Measured at roughly 0.25 against 0.37; assert the direction and a
    // margin, not the exact figure, so a retune doesn't fail on noise.
    expect(balanced / 8).toBeLessThan(0.32);
  });

  it("leaves the plain round robin untouched when no genders are given", () => {
    const a = planPerfectSchedule(12, 3, 8, { random: mulberry(99) });
    const b = planPerfectSchedule(12, 3, 8, { random: mulberry(99) });
    expect(a).toEqual(b);
    expect(partnerships(a!)).toEqual({ distinct: 48, repeated: 0 });
  });
});

describe("generateRound, gender format", () => {
  const players = (genders: Gender[]): GenPlayer[] =>
    genders.map((gender, i) => ({
      id: `p${i}`,
      // Deliberately spread out: this format does not balance on rating, and
      // a violation must not become affordable just because it evens teams up.
      rating: 3 + (i % 5) * 0.4,
      gender,
    }));

  it("prices the rule above everything else it trades off", () => {
    // Twenty repeated partnerships, which is what "top priority" has to mean
    // for a search that weighs one thing against another.
    expect(WEIGHTS.gender.gender).toBeGreaterThan(WEIGHTS.gender.partner * 20 - 1);
    expect(WEIGHTS.regular.gender).toBe(0);
    expect(WEIGHTS.balanced.gender).toBe(0);
  });

  it("never puts two men against two women when adding a round", () => {
    // The mid-session path: "add another round" doesn't go through the
    // whole-session planner, so the rule has to hold here independently.
    const genders = roster(4, 4);
    const byId = new Map(players(genders).map((p) => [p.id, p.gender!]));

    for (let seed = 0; seed < 25; seed++) {
      const round = generateRound(players(genders), 2, undefined, {
        format: "gender",
        random: mulberry(seed),
      });

      for (const court of round.courts) {
        expect(
          matchViolates(
            byId.get(court.teamA[0])!,
            byId.get(court.teamA[1])!,
            byId.get(court.teamB[0])!,
            byId.get(court.teamB[1])!,
          ),
        ).toBe(false);
      }
    }
  });

  it("holds the rule on a lopsided roster too", () => {
    const genders = roster(9, 3);
    const byId = new Map(players(genders).map((p) => [p.id, p.gender!]));

    for (let seed = 0; seed < 25; seed++) {
      const round = generateRound(players(genders), 3, undefined, {
        format: "gender",
        random: mulberry(seed),
      });

      for (const court of round.courts) {
        expect(
          matchViolates(
            byId.get(court.teamA[0])!,
            byId.get(court.teamA[1])!,
            byId.get(court.teamB[0])!,
            byId.get(court.teamB[1])!,
          ),
        ).toBe(false);
      }
    }
  });

  it("still rotates partners, like the regular round robin it is based on", () => {
    const genders = roster(4, 4);
    const squad = players(genders);
    const seen = new Set<string>();

    // Three rounds on two courts is twelve team slots; with regular's partner
    // weight every one of them should be a different pairing.
    let history = emptyHistory();
    for (let r = 0; r < 3; r++) {
      const round = generateRound(squad, 2, history, {
        format: "gender",
        random: mulberry(r + 1),
      });
      for (const c of round.courts) {
        seen.add([...c.teamA].sort().join("|"));
        seen.add([...c.teamB].sort().join("|"));
      }
      history = applyRound(history, round);
    }

    expect(seen.size).toBe(12);
  });
});

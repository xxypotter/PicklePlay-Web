import { describe, expect, it } from "vitest";
import { RATING, TUNING_V1_2, tuningFor } from "./constants";
import { kFactor, recompute, type TimelineEvent } from "./engine";

/**
 * The v1.3 changes: the first-five-matches boost is gone, and a provisional
 * rating can no longer be pushed to the bottom of the scale.
 *
 * Both came out of a real night — a new player who went from 2.50 to 3.77 in
 * eight games, and another who landed at 2.063 against a floor of 2.000.
 */

const DAY = 86_400_000;
const AFTER = new Date("2026-09-06T18:00:00.000Z"); // inside the v1.3 epoch
const BEFORE = new Date("2026-08-20T18:00:00.000Z"); // inside the v1.2 epoch

describe("the calibration window", () => {
  it("no longer multiplies K for a player's first matches", () => {
    // Same reliability, one inside the window and one outside it.
    const inside = kFactor(0, 1, RATING, 0);
    const outside = kFactor(0, 99, RATING, 0);
    expect(inside).toBeCloseTo(outside, 10);
  });

  it("still did, before the cutover", () => {
    const inside = kFactor(0, 1, TUNING_V1_2, 0);
    const outside = kFactor(0, 99, TUNING_V1_2, 0);
    expect(inside / outside).toBeCloseTo(1.25, 10);
  });

  it("takes the hottest K in the system below 1", () => {
    // 1.23 was the old peak, and every outlier in 160 matches lived there.
    let peak = 0;
    for (let matches = 0; matches < 12; matches++) {
      for (let rel = 0; rel <= 1; rel += 0.05) {
        peak = Math.max(peak, kFactor(rel, matches, RATING, matches));
      }
    }
    expect(peak).toBeLessThan(1);
    expect(peak).toBeCloseTo(RATING.K_BASE!, 5);
  });

  it("is dated, so an old match keeps the boost it was played under", () => {
    expect(tuningFor(BEFORE).CAL_MULT).toBe(1.25);
    expect(tuningFor(AFTER).CAL_MULT).toBe(1);
  });
});

/** A player seeded low who then loses badly, over and over. */
function collapse(at: Date, seed: number, games: number): number {
  const victim = "victim";
  const strong = ["s1", "s2", "s3"];
  const events: TimelineEvent[] = [
    {
      kind: "seed",
      at: new Date(at.getTime() - DAY),
      playerId: victim,
      rating: seed,
      declaredReliability: 0,
      isInitial: true,
      selfInitiated: true,
    },
    ...strong.map((id, i) => ({
      kind: "seed" as const,
      at: new Date(at.getTime() - DAY),
      playerId: id,
      rating: 4.0 + i * 0.05,
      declaredReliability: 0,
      isInitial: true,
      selfInitiated: true,
    })),
  ];

  for (let i = 0; i < games; i++) {
    events.push({
      kind: "match",
      at: new Date(at.getTime() + i * 3_600_000),
      matchId: `m${i}`,
      teamA: [victim, strong[0]],
      teamB: [strong[1], strong[2]],
      scoreA: 0,
      scoreB: 11,
    });
  }

  return recompute(events).players.get(victim)!.rating;
}

describe("the provisional floor", () => {
  it("stops a new player being driven to the bottom of the scale", () => {
    const after = collapse(AFTER, 2.7, 10);
    expect(after).toBeGreaterThanOrEqual(RATING.PROVISIONAL_FLOOR!);
  });

  it("did not exist before the cutover", () => {
    // The same collapse under v1.2 goes well below, which is what happened to
    // a real player: seeded 2.67, ended the night at 2.063.
    const before = collapse(BEFORE, 2.7, 10);
    expect(before).toBeLessThan(RATING.PROVISIONAL_FLOOR!);
  });

  it("is a floor, not a lift — it never hands anyone rating points", () => {
    /*
     * Someone already below the floor when it starts applying must stay where
     * they are. Otherwise a settled player who dropped to 2.2 and then re-seeds
     * themselves provisional would be *rewarded* for it.
     */
    const low = 2.2;
    const events: TimelineEvent[] = [
      {
        kind: "seed",
        at: new Date(AFTER.getTime() - DAY),
        playerId: "low",
        rating: low,
        declaredReliability: 0,
        isInitial: true,
        selfInitiated: true,
      },
      ...["a", "b", "c"].map((id, i) => ({
        kind: "seed" as const,
        at: new Date(AFTER.getTime() - DAY),
        playerId: id,
        rating: 4.0 + i * 0.05,
        declaredReliability: 0,
        isInitial: true,
        selfInitiated: true,
      })),
      {
        kind: "match",
        at: AFTER,
        matchId: "m",
        teamA: ["low", "a"],
        teamB: ["b", "c"],
        scoreA: 0,
        scoreB: 11,
      },
    ];
    const after = recompute(events).players.get("low")!.rating;
    expect(after).toBeLessThanOrEqual(low);
    expect(after).toBeLessThan(RATING.PROVISIONAL_FLOOR!);
  });

  it("leaves the ceiling and the scale minimum alone", () => {
    expect(RATING.PROVISIONAL_FLOOR!).toBeGreaterThan(RATING.MIN);
    expect(RATING.PROVISIONAL_FLOOR!).toBeLessThan(RATING.MAX);
  });
});

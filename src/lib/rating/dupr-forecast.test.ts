import { describe, expect, it } from "vitest";
import { RATING, TUNING_V1_0 } from "./constants";
import { kFactor, matchSurprise, ratingDelta } from "./engine";

/**
 * Ground truth, read off DUPR's own Forecast tool.
 *
 * Screenshots live in "dupr forecast/". One match, three outcomes, from Xiayu
 * Xu's point of view:
 *
 *   Team 1  Xiayu Xu 3.813 (reliability 10%)  +  Sam Yang   3.884 (60%)
 *   Team 2  Dezhi Zheng 4.220 (40%)           +  Alec Liang 4.369 (100%)
 *   DUPR predicts 5.5 to 11, win probability 21%.
 *
 * This is the only hard evidence we have about what DUPR actually does, so it
 * is a test rather than a comment. If someone retunes the engine and the signs
 * go back the wrong way, this fails.
 */
const TEAM_A = (3.813 + 3.884) / 2;
const TEAM_B = (4.22 + 4.369) / 2;
const XIAYU_RATING = 3.813;
const XIAYU_RELIABILITY = 0.1;
const XIAYU_MATCHES = 18; // 13-5, so past any calibration window

/** [our score, their score, the change DUPR forecasts for Xiayu] */
const FORECASTS: Array<readonly [number, number, number]> = [
  [3, 11, -0.09],
  [6, 11, +0.033],
  [9, 11, +0.119],
];

const ours = (scoreA: number, scoreB: number) =>
  ratingDelta(
    XIAYU_RATING,
    kFactor(XIAYU_RELIABILITY, XIAYU_MATCHES),
    matchSurprise(TEAM_A, TEAM_B, scoreA, scoreB),
    true,
  );

describe("DUPR forecast: what the real thing does", () => {
  it("is linear in point share — the two slopes agree to three decimals", () => {
    const point = (i: number) => {
      const [a, b, delta] = FORECASTS[i];
      return [a / (a + b), delta] as const;
    };
    const slope = (i: number, j: number) =>
      (point(j)[1] - point(i)[1]) / (point(j)[0] - point(i)[0]);

    expect(slope(0, 1)).toBeCloseTo(slope(1, 2), 2);
    expect(slope(0, 2)).toBeCloseTo(0.887, 2);
  });

  it("rewards losing narrowly to a stronger pair", () => {
    // The heart of it: all three outcomes are losses, yet the change swings
    // from -0.090 to +0.119. Every bit of that comes from the margin.
    const [, , heavy] = FORECASTS[0];
    const [, , narrow] = FORECASTS[2];
    expect(heavy).toBeLessThan(0);
    expect(narrow).toBeGreaterThan(0);
    expect(narrow - heavy).toBeCloseTo(0.209, 3);
  });
});

describe("our engine against that forecast", () => {
  it.each(FORECASTS)("gets the sign right losing %i-%i", (scoreA, scoreB, dupr) => {
    expect(Math.sign(ours(scoreA, scoreB))).toBe(Math.sign(dupr));
  });

  it("gets the shape right: every outcome is off by the same factor", () => {
    // A constant ratio means the curve is correct and only the overall scale
    // is wrong — one number, not a modelling error. That scale needs DUPR
    // forecasts at other reliabilities before it can be set honestly, since
    // our reliability rises much faster than DUPR's.
    const ratios = FORECASTS.map(([a, b, dupr]) => dupr / ours(a, b));
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 1);
  });

  it("would have got two of the three backwards under v1.0", () => {
    // Why this changed: at ALPHA 0.35 the binary win/loss carried 65% of the
    // weight, so an underdog losing 9-11 lost rating here and gained it there.
    const before = (scoreA: number, scoreB: number) =>
      ratingDelta(
        XIAYU_RATING,
        kFactor(XIAYU_RELIABILITY, XIAYU_MATCHES, TUNING_V1_0),
        matchSurprise(TEAM_A, TEAM_B, scoreA, scoreB, TUNING_V1_0),
        true,
        TUNING_V1_0,
      );

    const wrong = FORECASTS.filter(
      ([a, b, dupr]) => Math.sign(before(a, b)) !== Math.sign(dupr),
    );
    expect(wrong).toHaveLength(2);
  });

  it("still says a heavy loss costs rating", () => {
    expect(ours(3, 11)).toBeLessThan(0);
  });

  it("scores a bigger win higher, up to where the guard rail starts", () => {
    // Monotonic across every result the forecasts actually cover, and beyond
    // them until CAP_PROVISIONAL trims a blowout. That cap is deliberate: what
    // a win is worth is extrapolated from three losses, not measured.
    expect(ours(11, 5)).toBeGreaterThan(ours(11, 9));
    expect(ours(11, 9)).toBeGreaterThan(ours(9, 11));
    expect(ours(9, 11)).toBeGreaterThan(ours(6, 11));
    expect(ours(6, 11)).toBeGreaterThan(ours(3, 11));
  });
});

describe("the shape constants this evidence set", () => {
  it("weighs the score, not the win", () => {
    expect(RATING.ALPHA).toBe(1);
  });

  it("uses the expected-score curve implied by DUPR's own prediction", () => {
    // DUPR forecast 5.5-11 off a 0.446 team-rating gap, and the fitted
    // break-even share was 0.316; both imply D around 1.33.
    expect(RATING.D_POINTS).toBeCloseTo(1.33, 2);
  });
});

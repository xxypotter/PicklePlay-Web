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
  [11, 9, +0.206],
  [11, 8, +0.232],
  [11, 6, +0.291],
  [11, 3, +0.411],
];

/**
 * The same match from Sam Yang's account — 3.884 at 60% reliability.
 *
 * Two players in one match is what makes the K curve measurable: everything
 * about the match is held constant and only reliability differs.
 */
const SAM_RATING = 3.884;
const SAM_RELIABILITY = 0.6;
const SAM_MATCHES = 61; // 37-24
const SAM_FORECASTS: Array<readonly [number, number, number]> = [
  [3, 11, -0.038],
  [6, 11, +0.014],
  [9, 11, +0.05],
  [11, 9, +0.087],
  [11, 6, +0.123],
  [11, 3, +0.174],
];

/**
 * The same match a third time, from Alec Liang's account — 4.369 at 100%
 * reliability, and on the *strong* side, so his team is Team 1 here.
 *
 * This is the case reliability alone cannot describe: the power law reaches
 * zero at 100%, yet DUPR still moves him. He reports a half-life of 40, which
 * is what anchors the floor.
 */
const ALEC_RATING = 4.369;
const ALEC_HALF_LIFE = 40;
const ALEC_MATCHES = 118; // 81-37
const ALEC_FORECASTS: Array<readonly [number, number, number]> = [
  [3, 11, -0.044],
  [11, 9, -0.013],
  [11, 6, -0.004],
  [11, 3, +0.01],
];

/** Decayed match counts we can only estimate for the first two. */
const XIAYU_HALF_LIFE = 15;
const SAM_HALF_LIFE = 25;

const ours = (scoreA: number, scoreB: number) =>
  ratingDelta(
    XIAYU_RATING,
    kFactor(XIAYU_RELIABILITY, XIAYU_MATCHES, RATING, XIAYU_HALF_LIFE),
    matchSurprise(TEAM_A, TEAM_B, scoreA, scoreB),
    true,
  );

const sams = (scoreA: number, scoreB: number) =>
  ratingDelta(
    SAM_RATING,
    kFactor(SAM_RELIABILITY, SAM_MATCHES, RATING, SAM_HALF_LIFE),
    matchSurprise(TEAM_A, TEAM_B, scoreA, scoreB),
    false,
  );

const alecs = (scoreA: number, scoreB: number) =>
  ratingDelta(
    ALEC_RATING,
    kFactor(1, ALEC_MATCHES, RATING, ALEC_HALF_LIFE),
    // Alec sits on the strong side, so the teams swap.
    matchSurprise(TEAM_B, TEAM_A, scoreA, scoreB),
    false,
  );

describe("DUPR forecast: what the real thing does", () => {
  it("agrees with itself from both sides of the net", () => {
    // Xiayu's forecasts break even at a point share of 0.3155; Alec is on the
    // other team, and his break even at 0.6849. They sum to 1.0004, which is
    // as close to independent confirmation as this data gets.
    expect(0.3155 + 0.6849).toBeCloseTo(1, 2);
  });

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

  it("has no jump at the win boundary — winning by itself is worth nothing", () => {
    // 9-11 is a loss and 11-9 is a win, one point apart in share. If DUPR paid
    // anything for the win as such there would be a step here. There isn't:
    // both sit on the same straight line.
    const line = (share: number) => 0.8770 * share - 0.8770 * 0.3155;
    expect(line(9 / 20)).toBeCloseTo(0.119, 2);
    expect(line(11 / 20)).toBeCloseTo(0.206, 2);
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

  // A hundredth of a rating point. DUPR reports to three decimals, but its own
  // figures are a forecast, and the half-lives behind two of these are
  // estimated rather than known.
  const TOLERANCE = 0.01;

  it.each(FORECASTS)("matches DUPR at 10%% reliability, %i-%i", (a, b, dupr) => {
    expect(Math.abs(ours(a, b) - dupr)).toBeLessThan(TOLERANCE);
  });

  it.each(SAM_FORECASTS)("matches DUPR at 60%% reliability, %i-%i", (a, b, dupr) => {
    expect(Math.abs(sams(a, b) - dupr)).toBeLessThan(TOLERANCE);
  });

  it.each(ALEC_FORECASTS)("matches DUPR at 100%% reliability, %i-%i", (a, b, dupr) => {
    expect(Math.abs(alecs(a, b) - dupr)).toBeLessThan(TOLERANCE);
  });

  it("still moves a 100% reliable player, and can drop them after a win", () => {
    // 11-6 is a win, and costs him rating, because DUPR expected 11-5.5.
    expect(alecs(11, 6)).toBeLessThan(0);
    expect(alecs(11, 3)).toBeGreaterThan(0);
  });

  it("reproduces all seventeen to within a hundredth", () => {
    const errors = [
      ...FORECASTS.map(([a, b, d]) => Math.abs(ours(a, b) - d)),
      ...SAM_FORECASTS.map(([a, b, d]) => Math.abs(sams(a, b) - d)),
      ...ALEC_FORECASTS.map(([a, b, d]) => Math.abs(alecs(a, b) - d)),
    ];
    expect(errors).toHaveLength(17);
    expect(Math.max(...errors)).toBeLessThan(0.01);
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

describe("the constants this evidence set", () => {
  it("weighs the score, not the win", () => {
    expect(RATING.ALPHA).toBe(1);
  });

  it("follows k = (1 - reliability), which is what the two players imply", () => {
    // k(0.10) = 0.877 and k(0.60) = 0.371 from the two fitted slopes. A
    // straight line between them predicts a negative K for anyone fully
    // established, which is why the law is a power rather than a line.
    const fromReliability = (rel: number) =>
      (RATING.K_BASE ?? 0) * Math.pow(1 - rel, RATING.K_EXPONENT ?? 1);

    expect(fromReliability(0.1)).toBeCloseTo(0.877, 2);
    expect(fromReliability(0.6)).toBeCloseTo(0.371, 2);

    const linear =
      fromReliability(0.1) +
      ((fromReliability(0.6) - fromReliability(0.1)) / 0.5) * 0.9;
    expect(linear).toBeLessThan(0);
  });

  it("keeps a fully reliable player moving, less the more they have played", () => {
    // Reliability saturates at 100% and stops separating anyone; volume takes
    // over. Our most-played member noticing that his rating still moves — and
    // moves more than longer-serving opponents — is this effect.
    const fresh = kFactor(1, 50, RATING, 0);
    const seasoned = kFactor(1, 50, RATING, 120);
    expect(fresh).toBeGreaterThan(0);
    expect(seasoned).toBeGreaterThan(0);
    expect(seasoned).toBeLessThan(fresh / 3);
  });

  it("matches the one 100% reliability reading we have", () => {
    expect(kFactor(1, 118, RATING, 40)).toBeCloseTo(0.094, 3);
  });

  it("hands over from the reliability law to the volume floor near 89%", () => {
    // Below the crossover the power law is larger and decides everything.
    const law = (rel: number) =>
      (RATING.K_BASE ?? 0) * Math.pow(1 - rel, RATING.K_EXPONENT ?? 1);
    expect(kFactor(0.6, 50, RATING, 40)).toBeCloseTo(law(0.6), 4);
    expect(kFactor(0.95, 50, RATING, 40)).toBeGreaterThan(law(0.95));
  });

  it("uses the expected-score curve implied by DUPR's own prediction", () => {
    // DUPR forecast 5.5-11 off a 0.446 team-rating gap, and the fitted
    // break-even share was 0.316; both imply D around 1.33.
    expect(RATING.D_POINTS).toBeCloseTo(1.33, 2);
  });
});

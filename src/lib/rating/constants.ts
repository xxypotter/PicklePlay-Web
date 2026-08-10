/**
 * Tunable constants for the PicklePlay Rating (PPR) engine.
 *
 * Every number here is documented in SPEC.md §5, and they live in one place
 * because ratings are always rebuilt from the full match history (§5.6).
 *
 * That has a sharp edge: for most of these, editing the value and re-running
 * the recompute rewrites the past as well as the future. The movement knobs —
 * the K-factors and the per-match caps — are therefore versioned rather than
 * simply edited; see `Tuning` and `tuningFor` below. Everything else describes
 * what a rating *is* rather than how fast it reacts, and changing one of those
 * genuinely does mean "we were computing it wrong", so replaying history under
 * the correction is the right behaviour.
 */
export const RATING = {
  /** Rating scale bounds, matching DUPR's published 2.0-8.0 range. */
  MIN: 2.0,
  MAX: 8.0,

  /**
   * Spread constants for the two expectation curves (§5.3 step 1).
   * D_POINTS: a 1.00 rating gap predicts ~78.6% point share (roughly 11-3).
   * D_WIN:    a 1.00 rating gap predicts a ~90% win probability.
   * D_WIN is deliberately steeper than D_POINTS.
   */
  D_POINTS: 1.33,
  D_WIN: 1.0,

  /**
   * How much of the signal comes from margin vs. pure win/loss (§5.3 step 2).
   *
   * 1.0 means the score is everything and winning, by itself, is worth nothing
   * — which is what DUPR's own Forecast shows. Three outcomes of one match
   * (screenshots in "dupr forecast/"): losing 3-11 costs 0.090, losing 6-11
   * *gains* 0.033, losing 9-11 gains 0.119. All three are losses, so every bit
   * of that 0.209 swing comes from the margin, and DUPR's own wording is
   * "score at least 6 points to see your rating rise" rather than anything
   * about winning.
   *
   * At the old 0.35 the binary win/loss carried 65% of the weight, which made
   * us return the wrong sign for an underdog losing narrowly: we took rating
   * away from a performance DUPR rewards.
   *
   * Kept as a parameter rather than deleted. The forecasts available are all
   * losses, so they pin ALPHA x K but cannot separate a genuine win bonus from
   * none at all; a single win forecast would settle it.
   */
  ALPHA: 1.0,

  /**
   * How far a match moves you, as a function of how well established you are.
   *
   * Measured, not chosen. Thirteen DUPR forecasts of one match — seven from a
   * player at 10% reliability, six from his partner at 60% — give
   *
   *     k(0.10) = 0.877     k(0.60) = 0.371
   *
   * and those two land almost exactly on k = (1 − reliability). Fitting the
   * exponent gives 0.98 × (1 − reliability)^1.06, with every one of the
   * thirteen predicted to within 0.0014.
   *
   * Note what that means at the top: k reaches zero at 100%, so reliability
   * alone would freeze a fully established player forever. It doesn't happen
   * in DUPR, which is what K_SETTLED below is for.
   */
  K_LAW: "reliability-power" as const,
  K_BASE: 0.98,
  K_EXPONENT: 1.06,

  /**
   * What still moves a player who is already 100% reliable.
   *
   * Reliability saturates: once you're at 100% it can't tell a player with
   * twenty logged matches from one with a thousand, yet DUPR plainly still
   * separates them — our most-played member notices that his rating moves more
   * than opponents with even longer histories. So past that ceiling the amount
   * of live evidence takes over. `halfLife` is the decayed match count (§5.4),
   * so this shrinks as someone's record deepens and recovers if they stop
   * playing and their evidence ages out.
   *
   * Deliberately small. It is the tail of the curve, not a second opinion —
   * the reliability law above is doing the work everywhere it can.
   */
  K_SETTLED: 0.02,
  HALF_LIFE_SCALE: 25,

  /**
   * Floor on K until a player has played SEED_FLOOR_MATCHES real matches here.
   * Stops someone declaring "4.5 at 100% reliability" at signup and becoming
   * immovable on the strength of a number nobody verified (§5.7). It matters
   * more under the new law, where a declared 100% would otherwise put them
   * straight onto K_SETTLED.
   */
  K_SEED_FLOOR: 0.15,
  SEED_FLOOR_MATCHES: 5,

  /** Calibration window: K is boosted for a player's first few local matches. */
  CAL_MATCHES: 5,
  CAL_MULT: 1.25,

  /**
   * Per-match movement caps — a guard against absurdity, not a working limit.
   *
   * This has to sit above every ordinary scoreline or it stops being a guard
   * and starts being the answer: at 0.20 an unproven player got exactly the
   * same move for 11-9, 11-3 and 11-0, erasing the margin signal that is now
   * the whole mechanism.
   *
   * Now a genuine backstop rather than a working limit, because the win side
   * turned out to be measured after all: DUPR forecasts +0.411 for an 11-3 win
   * in the very match above. A cap anywhere near that would contradict the
   * data it is supposed to be protecting. These only catch nonsense — a score
   * typed as 99-0, say.
   */
  CAP_PROVISIONAL: 0.6,
  CAP_RELIABLE: 0.5,

  /**
   * Evidence decay (§5.4). Matches halve in weight every 90 days, which
   * reproduces DUPR's "results needed doubles every 90 days" property.
   * Self-declared ratings are not evidence at any age — only matches played
   * here count toward reliability.
   */
  MATCH_HALF_LIFE_DAYS: 90,

  /*
   * Reliability follows DUPR's published doubles waypoints. They state that a
   * reliable (60%) doubles rating needs 2+ unique partners and 6+ unique
   * opposing teams, and that 100% needs 4+ and 12+.
   *
   * Counting distinct *partners* and *opposing teams* rather than raw matches
   * is the whole point: ten games against the same three people teaches the
   * system far less than six against six different pairs, and DUPR says so
   * explicitly. A 9-player round robin gives 8 partners and 8 opposing teams in
   * one night, which is why a single session settles a new player.
   */
  PARTNERS_AT_60: 2,
  PARTNERS_AT_100: 4,
  TEAMS_AT_60: 6,
  TEAMS_AT_100: 12,

  /**
   * What a partner or opponent is worth when they aren't reliable themselves.
   *
   * DUPR weights results by who you played: a reliable opponent is better
   * evidence than an unknown one. Taken literally that never starts — a new
   * group is all zeroes, so nobody can ever lift anybody. A floor fixes it
   * without penalising anyone: someone already at 60% counts a full 1.0,
   * exactly as a plain head-count would, so an established group is unaffected
   * and only a group of strangers takes longer.
   */
  UNKNOWN_WEIGHT: 0.5,

  /** At or above this, a rating is reliable and loses its `?`. */
  RELIABILITY_PASS: 0.6,

  /** Ratings compress within this many points of the floor/ceiling. */
  COMPRESS_BAND: 1.5,

  /** Rating assigned to a player who appears in a match with no seed on record. */
  DEFAULT_RATING: 3.0,
} as const;

/**
 * The knobs that decide how far a rating moves after one match.
 *
 * Split out from the rest because these are the only ones we version. The
 * curves, the reliability waypoints and the scale describe what a rating *is*;
 * these describe how fast it reacts, which is the part we got wrong and the
 * part we expect to keep tuning.
 */
export interface Tuning {
  /** Margin vs win/loss weighting, and the curve that sets the expected score. */
  ALPHA: number;
  D_POINTS: number;
  /**
   * Which K law applies. v1.0 interpolated linearly between two endpoints;
   * the calibrated law is a power of (1 - reliability) with a volume-based
   * tail. Named rather than inferred so reading either tuning tells you
   * exactly what it did.
   */
  K_LAW: "linear" | "reliability-power";
  /** `linear` only. */
  K_NEW?: number;
  K_RELIABLE?: number;
  /** `reliability-power` only. */
  K_BASE?: number;
  K_EXPONENT?: number;
  K_SETTLED?: number;
  HALF_LIFE_SCALE?: number;
  K_SEED_FLOOR: number;
  SEED_FLOOR_MATCHES: number;
  CAL_MATCHES: number;
  CAL_MULT: number;
  CAP_PROVISIONAL: number;
  CAP_RELIABLE: number;
}

/**
 * What the engine did before the v1.1 recalibration.
 *
 * Ratings are rebuilt from the whole match history every time, so changing a
 * constant normally rewrites the past as well as the future — every session
 * ever played would be re-scored under the new numbers and everybody's record
 * would silently move. Results that have already been shown to players are
 * theirs; we don't get to revise them because we later improved the formula.
 *
 * So the tuning is dated. Matches played before the cutover keep replaying
 * under exactly these values and come out bit-identical; matches after it use
 * the current ones. The recompute stays a pure function of history, and the
 * history stops being a moving target.
 */
export const TUNING_V1_0: Tuning = {
  ALPHA: 0.35,
  D_POINTS: 1.75,
  K_LAW: "linear",
  K_NEW: 0.5,
  K_RELIABLE: 0.06,
  K_SEED_FLOOR: 0.15,
  SEED_FLOOR_MATCHES: 5,
  CAL_MATCHES: 5,
  CAL_MULT: 1.5,
  CAP_PROVISIONAL: 0.25,
  CAP_RELIABLE: 0.1,
};

/**
 * When the recalibrated tuning takes over.
 *
 * Sits after the last match of the three sessions played under v1.0 (the most
 * recent was 2026-08-09T13:24Z) and before anything played since. Editing an
 * old score keeps that match on the old tuning, because saving a correction
 * updates `editedAt` and leaves `playedAt` alone.
 */
export const RECALIBRATED_FROM = new Date("2026-08-10T00:00:00.000Z");

/** Which movement tuning applies to a match played at this moment. */
export function tuningFor(at: Date): Tuning {
  return at.getTime() < RECALIBRATED_FROM.getTime() ? TUNING_V1_0 : RATING;
}

/**
 * How long a player must wait between self-service re-seeds (§5.8).
 *
 * Lives here rather than beside reseedAction because a "use server" module may
 * only export async functions.
 */
export const RESEED_COOLDOWN_DAYS = 30;

/**
 * Starting ratings for players who don't have a real DUPR to enter (§5.7).
 *
 * Recentred for v1.1. The ladder used to put "intermediate" — which is what
 * most people honestly pick — at 3.5, above where this group actually plays,
 * so a self-assessed newcomer started ahead of established members and spent
 * their first sessions being corrected downward. The rungs still mean the same
 * things relative to each other; the whole ladder just sits where the group
 * really is.
 */
export const SKILL_PICKER = [
  { key: "new", label: "Brand new / first time", rating: 2.5 },
  { key: "beginner", label: "Beginner — know the rules, still learning", rating: 2.75 },
  { key: "intermediate", label: "Intermediate — consistent rallies, some strategy", rating: 3.0 },
  { key: "advanced", label: "Advanced — comfortable at the kitchen, place shots", rating: 3.5 },
  { key: "competitive", label: "Competitive — play tournaments", rating: 4.0 },
] as const;

export type SkillKey = (typeof SKILL_PICKER)[number]["key"];

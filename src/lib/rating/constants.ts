/**
 * Tunable constants for the PicklePlay Rating (PPR) engine.
 *
 * Every number here is documented in SPEC.md §5. They live in one place on
 * purpose: because ratings are always recomputed from the full match history
 * (§5.6), changing a value here and re-running the recompute replays all of
 * history under the new constants. Nothing is baked in.
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
  D_POINTS: 1.75,
  D_WIN: 1.0,

  /**
   * How much of the signal comes from margin vs. pure win/loss (§5.3 step 2).
   * 0.35 => 65% "did you win", 35% "by how much". This is what reproduces
   * DUPR's documented behavior that score margin barely matters.
   */
  ALPHA: 0.35,

  /** K-factor endpoints: reliability 0 -> K_NEW, reliability 1 -> K_RELIABLE. */
  K_NEW: 0.5,
  K_RELIABLE: 0.06,

  /**
   * Floor on K until a player has played SEED_FLOOR_MATCHES real matches here.
   * Stops someone declaring "4.5 at 100% reliability" at signup and becoming
   * immovable on the strength of a number nobody verified (§5.7).
   */
  K_SEED_FLOOR: 0.15,
  SEED_FLOOR_MATCHES: 5,

  /** Calibration window: K is boosted for a player's first few local matches. */
  CAL_MATCHES: 5,
  CAL_MULT: 1.5,

  /** Per-match movement caps. */
  CAP_PROVISIONAL: 0.25,
  CAP_RELIABLE: 0.1,

  /**
   * Evidence decay (§5.4). Matches halve in weight every 90 days, which
   * reproduces DUPR's "results needed doubles every 90 days" property.
   * Self-declared ratings are not evidence at any age — only matches played
   * here count toward reliability.
   */
  MATCH_HALF_LIFE_DAYS: 90,

  /** Reliability inputs: full credit at 10 weighted matches / 8 distinct opponents. */
  HL_FULL: 10,
  OPPONENTS_FULL: 8,
  /** Weights of the two reliability terms; must sum to 1. */
  W_HALF_LIFE: 0.6,
  W_OPPONENTS: 0.4,

  /** Below either of these, a rating is shown as Provisional. */
  HL_RELIABLE: 3.0,
  RELIABILITY_PASS: 0.6,

  /** Ratings compress within this many points of the floor/ceiling. */
  COMPRESS_BAND: 1.5,

  /** Rating assigned to a player who appears in a match with no seed on record. */
  DEFAULT_RATING: 3.5,
} as const;

/**
 * How long a player must wait between self-service re-seeds (§5.8).
 *
 * Lives here rather than beside reseedAction because a "use server" module may
 * only export async functions.
 */
export const RESEED_COOLDOWN_DAYS = 30;

/** Starting ratings for players who don't have a real DUPR to enter (§5.7). */
export const SKILL_PICKER = [
  { key: "new", label: "Brand new / first time", rating: 2.5 },
  { key: "beginner", label: "Beginner — know the rules, still learning", rating: 3.0 },
  { key: "intermediate", label: "Intermediate — consistent rallies, some strategy", rating: 3.5 },
  { key: "advanced", label: "Advanced — comfortable at the kitchen, place shots", rating: 4.0 },
  { key: "competitive", label: "Competitive — play tournaments", rating: 4.5 },
] as const;

export type SkillKey = (typeof SKILL_PICKER)[number]["key"];

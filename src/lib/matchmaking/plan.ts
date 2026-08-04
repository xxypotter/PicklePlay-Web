/**
 * How many rounds a session should actually run.
 *
 * The old suggestion was a rule of thumb — "about six games each" — which is
 * fine for a casual night and wrong for a round robin, because a round robin
 * has an exact answer that the thumb doesn't know about.
 *
 * Two conditions have to hold at once:
 *
 *   1. Even split. Each round seats `courts * 4` players, so across `r` rounds
 *      there are `r * seats` playing slots. Unless that divides by the number
 *      of players, somebody plays more games than everyone else. No generator
 *      can fix this — it is arithmetic, not scheduling.
 *
 *   2. Full coverage. "Partner with everyone once" needs n*(n-1)/2 distinct
 *      partnerships, and each round produces two per court.
 *
 * With 9 players on 2 courts both conditions land on 9 rounds: 72 slots over 9
 * players is 8 games each with exactly one bye, and 36 partnerships is exactly
 * C(9,2). Ask for 8 rounds instead and condition 1 fails — 64 slots over 9
 * players — so one player necessarily plays 8 while the other eight play 7.
 */

export interface RoundPlan {
  rounds: number;
  gamesEach: number;
  /** Does every player partner every other exactly once at this length? */
  fullCoverage: boolean;
}

/** Playing slots per round, once courts are capped by who actually showed up. */
export function seatsFor(playerCount: number, courtCount: number): number {
  return Math.min(courtCount, Math.floor(playerCount / 4)) * 4;
}

/** Do the playing slots divide evenly across everyone? */
export function splitsEvenly(
  playerCount: number,
  courtCount: number,
  rounds: number,
): boolean {
  const seats = seatsFor(playerCount, courtCount);
  if (seats === 0 || playerCount === 0) return false;
  return ((rounds * seats) % playerCount) === 0;
}

const MAX_ROUNDS = 20;

/**
 * The round count a regular round robin wants.
 *
 * Prefers the length that completes the round robin outright. When the player
 * count makes that impossible (10 players on 2 courts needs 11.25 rounds), it
 * falls back to the nearest length that at least splits evenly, searching
 * outward from the ideal so the answer stays near a sensible session length.
 */
export function planRegularRounds(
  playerCount: number,
  courtCount: number,
): RoundPlan | null {
  const seats = seatsFor(playerCount, courtCount);
  if (seats === 0) return null;

  const games = (r: number) => (r * seats) / playerCount;

  // Two partnerships per court per round.
  const ideal = (playerCount * (playerCount - 1)) / 2 / (seats / 2);

  if (
    Number.isInteger(ideal) &&
    ideal <= MAX_ROUNDS &&
    splitsEvenly(playerCount, courtCount, ideal)
  ) {
    return { rounds: ideal, gamesEach: games(ideal), fullCoverage: true };
  }

  // Search outward from the ideal for the closest even split.
  const start = Math.max(1, Math.round(ideal));
  for (let d = 0; d <= MAX_ROUNDS; d++) {
    for (const r of d === 0 ? [start] : [start - d, start + d]) {
      if (r >= 1 && r <= MAX_ROUNDS && splitsEvenly(playerCount, courtCount, r)) {
        return { rounds: r, gamesEach: games(r), fullCoverage: false };
      }
    }
  }

  return null;
}

/** The generic "decent night" length, for formats that aren't a round robin. */
export function planCasualRounds(playerCount: number, courtCount: number): number {
  const seats = seatsFor(playerCount, courtCount);
  if (seats === 0) return 3;
  return Math.max(3, Math.min(12, Math.round((playerCount / seats) * 6)));
}

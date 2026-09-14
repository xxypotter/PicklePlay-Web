/**
 * Whole-session scheduling for the regular round robin.
 *
 * `generateRound` builds one round at a time, hill-climbing on a cost function.
 * That is the right shape for "add another round" mid-session, but it cannot
 * see a whole-session design: it picks a locally cheap round 4 that strands
 * round 8 with no unused pairs left. A real session showed it — nine players
 * over nine rounds came out with 34 distinct partnerships instead of 36, two
 * pairs repeating while two never met.
 *
 * The fix is to stop treating it as nine independent problems. Nine players
 * need 36 partnerships and there are exactly 36 available, so a perfect
 * schedule is a decomposition of the complete graph, not a greedy walk. This
 * module searches for that decomposition directly and reports honestly when
 * none exists, so the caller can fall back rather than quietly ship a flawed
 * draw.
 *
 * Pure, seeded, and index-based: no database, no clock, no player ids.
 */
import { countViolations, matchViolates, type Gender } from "./gender";

/** One match as four seat indices: [a1, a2] play [b1, b2]. */
export type PlannedMatch = [number, number, number, number];
/** A round is one match per court in use. */
export type PlannedRound = PlannedMatch[];

export interface PlanOptions {
  restarts?: number;
  random?: () => number;
  /**
   * Gender per seat, for the gender-balanced format. When given, a draw that
   * puts two men against two women is rejected in favour of one that doesn't,
   * ahead of every other consideration.
   */
  genders?: readonly Gender[];
  /**
   * Rating per seat. When given, the draw prefers matchups where the two teams
   * are close — under the gender rule and under partner rotation, never over
   * them. See `BALANCE_WEIGHT`.
   */
  ratings?: readonly number[];
}

/**
 * What an even matchup is worth when choosing who faces whom.
 *
 * Third priority, and it costs the first two nothing. Partner rotation is not
 * in this trade at all — it is a hard constraint settled before we get here —
 * and neither is the gender rule, which outranks everything at 1e6. Measured
 * over 30 draws of a real 8M/2F roster, partnership coverage is 40 of 40 and
 * violations are zero at every weight tried. The only thing balance actually
 * competes with is opponent variety.
 *
 * That trade, on the same 30 draws (mean team gap / matches over 0.5 / pairs
 * who never meet, out of 45):
 *
 *     0  →  0.372 / 5.7 / 0.6      the night that prompted this
 *     4  →  0.301 / 4.1 / 1.6
 *    10  →  0.246 / 2.7 / 2.6      here
 *    25  →  0.196 / 1.5 / 5.5      too far
 *
 * At 25 the worst pair meets four times and five pairs never meet at all,
 * which is precisely the opponent clustering that had to be fixed once
 * already. At 10 the lopsided courts are more than halved and the opponent
 * spread barely moves.
 */
const BALANCE_WEIGHT = 10;

/** Mean team gap, summed across a whole schedule. */
function totalGap(schedule: PlannedRound[], ratings: readonly number[]): number {
  let sum = 0;
  for (const round of schedule) {
    for (const [a1, a2, b1, b2] of round) {
      sum += Math.abs((ratings[a1] + ratings[a2]) / 2 - (ratings[b1] + ratings[b2]) / 2);
    }
  }
  return sum;
}

/**
 * A violation is worth more than any opponent imbalance a schedule can carry,
 * so ranking on their sum ranks on violations first and uses balance only to
 * separate schedules that break the rule equally often.
 */
const VIOLATION_COST = 1e6;

const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Seats actually filled: whole courts only, capped by the courts available. */
export function seatsUsed(playerCount: number, courtCount: number): number {
  return Math.min(courtCount, Math.floor(playerCount / 4)) * 4;
}

/**
 * Can a schedule of this shape possibly avoid repeating a partnership?
 *
 * Every round consumes `seats / 2` pairs and there are only C(n,2) in
 * existence, so past that point repeats are arithmetic rather than bad luck.
 * Checked up front so an impossible request fails instantly instead of after
 * a few hundred fruitless restarts.
 */
export function perfectSchedulePossible(
  playerCount: number,
  courtCount: number,
  rounds: number,
): boolean {
  const seats = seatsUsed(playerCount, courtCount);
  if (seats === 0 || rounds < 1) return false;
  const needed = rounds * (seats / 2);
  const available = (playerCount * (playerCount - 1)) / 2;
  return needed <= available;
}

/**
 * Pair up the seated players using only partnerships nobody has had yet.
 *
 * Straight backtracking over an explicit edge list. The candidate order is
 * shuffled by the caller's generator, so successive restarts explore genuinely
 * different matchings rather than re-deriving the same failure.
 */
function matchSeated(
  seated: number[],
  used: Set<string>,
  random: () => number,
): Array<[number, number]> | null {
  const pairs: Array<[number, number]> = [];
  const taken = new Set<number>();

  const recurse = (): boolean => {
    // Lowest unpaired seat first: fixing one endpoint keeps the branching
    // factor at "who can partner this player" rather than every pair at once.
    const next = seated.find((p) => !taken.has(p));
    if (next === undefined) return true;

    taken.add(next);
    for (const other of shuffled(seated, random)) {
      if (other === next || taken.has(other)) continue;
      if (used.has(key(next, other))) continue;

      taken.add(other);
      pairs.push([next, other]);
      if (recurse()) return true;
      pairs.pop();
      taken.delete(other);
    }
    taken.delete(next);
    return false;
  };

  return recurse() ? pairs : null;
}

/**
 * Group this round's pairs into matches, preferring opponents who haven't met.
 *
 * Partnership uniqueness is already guaranteed by the time we get here, so this
 * only decides who faces whom. Exhaustive: with at most four courts there are
 * a handful of groupings and enumerating them is cheaper than being clever.
 */
function groupIntoMatches(
  pairs: Array<[number, number]>,
  opponents: Map<string, number>,
  genders?: readonly Gender[],
  ratings?: readonly number[],
): PlannedRound {
  const best: { round: PlannedRound; cost: number } = { round: [], cost: Infinity };

  /*
   * This is the step where the gender rule is actually won or lost. The teams
   * are already decided by the time we get here — a round holding both an
   * all-male and an all-female pair is fine, so long as they are not put across
   * the net from each other, and choosing who faces whom is exactly this
   * function's job.
   */
  const cost = (x: [number, number], y: [number, number]) => {
    const opposed =
      (opponents.get(key(x[0], y[0])) ?? 0) +
      (opponents.get(key(x[0], y[1])) ?? 0) +
      (opponents.get(key(x[1], y[0])) ?? 0) +
      (opponents.get(key(x[1], y[1])) ?? 0);

    const gap = ratings
      ? BALANCE_WEIGHT *
        Math.abs((ratings[x[0]] + ratings[x[1]]) / 2 - (ratings[y[0]] + ratings[y[1]]) / 2)
      : 0;

    if (!genders) return opposed + gap;
    const violates = matchViolates(
      genders[x[0]],
      genders[x[1]],
      genders[y[0]],
      genders[y[1]],
    );
    return opposed + gap + (violates ? VIOLATION_COST : 0);
  };

  const recurse = (remaining: Array<[number, number]>, acc: PlannedRound, total: number) => {
    if (total >= best.cost) return; // no grouping below here can win
    if (remaining.length === 0) {
      best.round = acc.map((m) => [...m] as PlannedMatch);
      best.cost = total;
      return;
    }
    const [head, ...rest] = remaining;
    for (let i = 0; i < rest.length; i++) {
      const partner = rest[i];
      const next = rest.filter((_, j) => j !== i);
      acc.push([head[0], head[1], partner[0], partner[1]]);
      recurse(next, acc, total + cost(head, partner));
      acc.pop();
    }
  };

  recurse(pairs, [], 0);
  return best.round;
}

/**
 * Choose who rests, fairest first.
 *
 * Most games played rests next, so nobody gets a second game before everyone
 * has had a first. Among equals, whoever has rested least often goes, which is
 * what stops the same person losing every other round.
 */
function chooseSitters(
  playerCount: number,
  sitCount: number,
  games: number[],
  rests: number[],
  random: () => number,
): number[] {
  const all = shuffled([...Array(playerCount).keys()], random);
  return all
    .sort((a, b) => games[b] - games[a] || rests[a] - rests[b])
    .slice(0, sitCount);
}

/**
 * How lopsided this schedule's opponents are.
 *
 * Partnership uniqueness is a hard constraint, but opponents are not: nine
 * players over nine rounds fill 72 opponent slots across 36 pairs, so exactly
 * two each is available and anything else means somebody is faced four times
 * while somebody else is never faced at all. A real session came out with one
 * pair meeting four times and ten meeting three or more.
 *
 * Squared error against the ideal, counting pairs who never met as if they were
 * two short — otherwise a schedule could hide its gaps by simply not creating
 * the encounter.
 */
function opponentImbalance(schedule: PlannedRound[], playerCount: number): number {
  const met = new Map<string, number>();
  let slots = 0;
  for (const round of schedule) {
    for (const [a1, a2, b1, b2] of round) {
      for (const a of [a1, a2]) {
        for (const b of [b1, b2]) {
          met.set(key(a, b), (met.get(key(a, b)) ?? 0) + 1);
          slots++;
        }
      }
    }
  }
  const possible = (playerCount * (playerCount - 1)) / 2;
  const ideal = slots / possible;
  let error = 0;
  for (const n of met.values()) error += (n - ideal) ** 2;
  error += (possible - met.size) * ideal ** 2; // pairs who never met
  return error;
}

/**
 * Build a full session where nobody partners the same person twice.
 *
 * Every restart that produces a valid schedule is scored on opponent balance
 * and the best is kept, rather than returning the first one that works. The
 * partnership constraint is satisfied either way; this decides how evenly the
 * *opponents* are spread, which is the difference between facing everyone twice
 * and facing one person four times.
 *
 * Returns null when no such schedule was found — either because one cannot
 * exist for these numbers, or because the search didn't reach it. Callers must
 * treat null as "use the ordinary generator", never as an error.
 */
export function planPerfectSchedule(
  playerCount: number,
  courtCount: number,
  rounds: number,
  options: PlanOptions = {},
): PlannedRound[] | null {
  /*
   * 500 rather than 60. The extra work buys opponent balance, not correctness:
   * every restart already satisfies the partnership promise, and the search
   * keeps the most evenly-opposed one. Measured over 50 draws that takes the
   * worst "faced N times" from 4 down to 3 in 48 of them, and costs ~60ms —
   * paid once when a session is laid out, not per round.
   */
  const { restarts = 500, random = Math.random, genders, ratings } = options;

  if (!perfectSchedulePossible(playerCount, courtCount, rounds)) return null;

  const seats = seatsUsed(playerCount, courtCount);
  const sitCount = playerCount - seats;

  let best: PlannedRound[] | null = null;
  let bestImbalance = Infinity;

  for (let attempt = 0; attempt < restarts; attempt++) {
    const used = new Set<string>();
    const opponents = new Map<string, number>();
    const games = new Array(playerCount).fill(0);
    const rests = new Array(playerCount).fill(0);
    const schedule: PlannedRound[] = [];

    let ok = true;
    for (let r = 0; r < rounds && ok; r++) {
      // A round can fail on its sitters rather than on the matching, so give a
      // few different rest choices a try before abandoning the whole attempt.
      let round: PlannedRound | null = null;
      let sitters: number[] = [];

      for (let tries = 0; tries < 8 && !round; tries++) {
        sitters = chooseSitters(playerCount, sitCount, games, rests, random);
        const seated = [...Array(playerCount).keys()].filter((p) => !sitters.includes(p));
        const pairs = matchSeated(seated, used, random);
        if (pairs) round = groupIntoMatches(pairs, opponents, genders, ratings);
      }

      if (!round) {
        ok = false;
        break;
      }

      for (const [a1, a2, b1, b2] of round) {
        used.add(key(a1, a2));
        used.add(key(b1, b2));
        for (const a of [a1, a2]) {
          for (const b of [b1, b2]) {
            opponents.set(key(a, b), (opponents.get(key(a, b)) ?? 0) + 1);
          }
        }
        for (const p of [a1, a2, b1, b2]) games[p]++;
      }
      for (const p of sitters) rests[p]++;

      schedule.push(round);
    }

    if (ok && schedule.length === rounds) {
      /*
       * Violations dominate the ranking when a gender is given, so a draw that
       * keeps two men off the other side of the net from two women wins over a
       * more evenly-opposed draw that doesn't. With no genders the term is
       * zero and this is the opponent-balance search it has always been.
       */
      const imbalance =
        opponentImbalance(schedule, playerCount) +
        (genders ? countViolations(schedule, genders) * VIOLATION_COST : 0) +
        (ratings ? BALANCE_WEIGHT * totalGap(schedule, ratings) : 0);

      if (imbalance < bestImbalance) {
        bestImbalance = imbalance;
        best = schedule;
        // Only a gender-blind, rating-blind draw can be perfect on this score;
        // with either term in play zero is unreachable and the loop runs on.
        if (imbalance === 0) break;
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Fixed partners
// ---------------------------------------------------------------------------

/** One match as two pair indices: pair A plays pair B. */
export type PlannedPairMatch = [number, number];
export type PlannedPairRound = PlannedPairMatch[];

/**
 * Schedule a fixed-partner session.
 *
 * Once the pairs are decided the problem changes shape: partners are no longer
 * something to solve for, so what's left is a round robin between *teams*.
 * Each round seats as many pairs as there are courts for, and the search
 * spends unused pairings first so everyone meets as many different opponents
 * as the round count allows.
 *
 * Returns null only when the shape is impossible — fewer than two pairs, or no
 * courts. Repeated opponents are fine and expected past the point where every
 * pair has met every other, so unlike `planPerfectSchedule` this does not give
 * up when it runs out of fresh pairings; it just starts reusing the least-used.
 */
/**
 * Pair up the seated teams, refusing any matchup already used more than `limit`
 * times.
 *
 * Backtracking, not greed. Choosing each team's least-met opponent in turn looks
 * reasonable and is wrong in the way that matters: it commits early and can
 * leave the last two teams holding a matchup they have already played, while
 * two other pairings go unused. A real eight-team night came out with 26
 * distinct matchups instead of 28, two of them twice — in seven rounds, where a
 * perfect draw exists.
 */
function matchTeams(
  seated: number[],
  met: Map<string, number>,
  limit: number,
  random: () => number,
): PlannedPairRound | null {
  const pairs: PlannedPairRound = [];
  const taken = new Set<number>();

  const recurse = (): boolean => {
    const next = seated.find((t) => !taken.has(t));
    if (next === undefined) return true;

    taken.add(next);
    for (const other of shuffled(seated, random)) {
      if (other === next || taken.has(other)) continue;
      if ((met.get(key(next, other)) ?? 0) > limit) continue;

      taken.add(other);
      pairs.push([next, other]);
      if (recurse()) return true;
      pairs.pop();
      taken.delete(other);
    }
    taken.delete(next);
    return false;
  };

  return recurse() ? pairs : null;
}

/** One go at a whole fixed-partner schedule, with the repeats it cost. */
function attemptPairSchedule(
  pairCount: number,
  perRound: number,
  rounds: number,
  random: () => number,
): { schedule: PlannedPairRound[]; repeats: number } | null {
  const met = new Map<string, number>();
  const games = new Array(pairCount).fill(0);
  const schedule: PlannedPairRound[] = [];
  let repeats = 0;

  for (let r = 0; r < rounds; r++) {
    let round: PlannedPairRound | null = null;

    /*
     * Raise the tolerance only when it is genuinely needed. Past the point
     * where every pairing has been used — eight teams have 28 of them, so a
     * ninth round must repeat something — a schedule has to reuse matchups, and
     * the second-time-round draw should be as even as the first.
     *
     * Who sits also decides whether a round can be matched at all, so try a few
     * different rests before conceding a repeat rather than after.
     */
    for (let limit = 0; limit < rounds && !round; limit++) {
      for (let tries = 0; tries < 8 && !round; tries++) {
        const order = shuffled([...Array(pairCount).keys()], random).sort(
          (a, b) => games[a] - games[b],
        );
        round = matchTeams(order.slice(0, perRound * 2), met, limit, random);
      }
    }

    if (!round) return null;

    for (const [a, b] of round) {
      const k = key(a, b);
      const before = met.get(k) ?? 0;
      repeats += before; // every prior meeting of this pair is one repeat
      met.set(k, before + 1);
      games[a]++;
      games[b]++;
    }

    schedule.push(round);
  }

  return { schedule, repeats };
}

/**
 * Schedule a fixed-partner session.
 *
 * Once the pairs are decided the problem changes shape: partners are no longer
 * something to solve for, so what's left is a round robin between *teams*. Eight
 * teams over seven rounds is a complete one — every team meets every other
 * exactly once — and that is a decomposition of K8, not something a greedy walk
 * reliably finds.
 *
 * So: backtracking for each round, restarted, keeping whichever attempt repeats
 * the fewest matchups. Unlike `planPerfectSchedule` this never gives up — a
 * night longer than the round robin simply has to replay opponents, and the
 * search then spreads those repeats instead of refusing.
 *
 * Returns null only when the shape is impossible: fewer than two pairs, or no
 * courts.
 */
export function planFixedPartnerRounds(
  pairCount: number,
  courtCount: number,
  rounds: number,
  options: PlanOptions = {},
): PlannedPairRound[] | null {
  const { restarts = 300, random = Math.random } = options;
  if (pairCount < 2 || courtCount < 1 || rounds < 1) return null;

  const perRound = Math.min(courtCount, Math.floor(pairCount / 2));
  if (perRound < 1) return null;

  let best: PlannedPairRound[] | null = null;
  let fewest = Infinity;

  for (let attempt = 0; attempt < Math.max(1, restarts) && fewest > 0; attempt++) {
    const got = attemptPairSchedule(pairCount, perRound, rounds, random);
    if (got && got.repeats < fewest) {
      fewest = got.repeats;
      best = got.schedule;
    }
  }

  return best;
}

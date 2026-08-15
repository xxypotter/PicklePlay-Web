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

/** One match as four seat indices: [a1, a2] play [b1, b2]. */
export type PlannedMatch = [number, number, number, number];
/** A round is one match per court in use. */
export type PlannedRound = PlannedMatch[];

export interface PlanOptions {
  restarts?: number;
  random?: () => number;
}

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
): PlannedRound {
  const best: { round: PlannedRound; cost: number } = { round: [], cost: Infinity };

  const cost = (x: [number, number], y: [number, number]) =>
    (opponents.get(key(x[0], y[0])) ?? 0) +
    (opponents.get(key(x[0], y[1])) ?? 0) +
    (opponents.get(key(x[1], y[0])) ?? 0) +
    (opponents.get(key(x[1], y[1])) ?? 0);

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
 * Build a full session where nobody partners the same person twice.
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
  const { restarts = 60, random = Math.random } = options;

  if (!perfectSchedulePossible(playerCount, courtCount, rounds)) return null;

  const seats = seatsUsed(playerCount, courtCount);
  const sitCount = playerCount - seats;

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
        if (pairs) round = groupIntoMatches(pairs, opponents);
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

    if (ok && schedule.length === rounds) return schedule;
  }

  return null;
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
export function planFixedPartnerRounds(
  pairCount: number,
  courtCount: number,
  rounds: number,
  options: PlanOptions = {},
): PlannedPairRound[] | null {
  const { random = Math.random } = options;
  if (pairCount < 2 || courtCount < 1 || rounds < 1) return null;

  const perRound = Math.min(courtCount, Math.floor(pairCount / 2));
  if (perRound < 1) return null;

  const met = new Map<string, number>();
  const games = new Array(pairCount).fill(0);
  const schedule: PlannedPairRound[] = [];

  for (let r = 0; r < rounds; r++) {
    // Pairs with the fewest games sit down last, so court time stays even.
    const order = shuffled([...Array(pairCount).keys()], random).sort(
      (a, b) => games[a] - games[b],
    );
    const seated = order.slice(0, perRound * 2);
    const remaining = new Set(seated);
    const round: PlannedPairRound = [];

    while (remaining.size >= 2) {
      const [first] = remaining;
      remaining.delete(first);
      // Whoever this pair has faced least often, ties broken by who has played
      // least — which keeps a strong pair from monopolising the fresh opponents.
      let best = -1;
      let bestCost = Infinity;
      for (const other of remaining) {
        const cost = (met.get(key(first, other)) ?? 0) * 10 + games[other];
        if (cost < bestCost) {
          bestCost = cost;
          best = other;
        }
      }
      remaining.delete(best);
      round.push([first, best]);
      met.set(key(first, best), (met.get(key(first, best)) ?? 0) + 1);
      games[first]++;
      games[best]++;
    }

    schedule.push(round);
  }

  return schedule;
}

/**
 * Swiss rounds for fixed pairs — the rules, with no database or UI.
 *
 * The idea is the CS Major Swiss stage. Every round pairs teams with the same
 * record, so after the first round nobody is stuck playing someone far stronger
 * or weaker: a 2–0 pair meets another 2–0 pair, a 0–2 pair another 0–2 pair.
 * Nobody is knocked out — everyone plays every round, and every pair then plays
 * two playoff games for a final place. Nobody plays the same opponent twice.
 *
 * Rounds are drawn one at a time, because each depends on the last one's
 * results. The organizer decides how many to play.
 */

export const SWISS_MIN_PAIRS = 6;
export const SWISS_MAX_PAIRS = 12;
export const SWISS_MIN_COURTS = 4;
export const SWISS_MAX_COURTS = 6;
/** Fewer than two rounds and the records haven't sorted anyone yet. */
export const SWISS_MIN_ROUNDS_BEFORE_PLAYOFFS = 2;

/** Capacity is checked here; the pair count is checked when round 1 is drawn. */
export const validSwissConfig = (courts: number, players: number) =>
  Number.isInteger(courts) && courts >= SWISS_MIN_COURTS && courts <= SWISS_MAX_COURTS &&
  Number.isInteger(players) && players >= SWISS_MIN_PAIRS * 2 && players <= SWISS_MAX_PAIRS * 2;

export const validPairCount = (pairs: number) =>
  Number.isInteger(pairs) && pairs >= SWISS_MIN_PAIRS && pairs <= SWISS_MAX_PAIRS;

/** Three rounds sort eight pairs into one 3–0, three 2–1, three 1–2 and one 0–3. */
export const suggestedRounds = (pairs: number) => (pairs <= 8 ? 3 : 4);

/**
 * Beyond this, a round without a rematch can't exist: every pair would have met
 * everyone. With an odd count each pair also has one bye, which adds a round.
 */
export const maxSwissRounds = (pairs: number) => (pairs % 2 === 0 ? pairs - 1 : pairs);

/** A pair is its two player ids, in a stable order (see sessions/medal.ts). */
export type PairKey = string;

export interface SwissGame {
  /** The higher-ranked pair when drawn. */
  a: PairKey;
  b: PairKey;
  scoreA: number | null;
  scoreB: number | null;
  status: "scheduled" | "completed" | "void";
}

export interface SwissRound {
  games: SwissGame[];
  /** The pair that sat out; a bye counts as a win. */
  bye: PairKey | null;
}

export interface SwissRow {
  key: PairKey;
  wins: number;
  losses: number;
  byes: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Strength of schedule: the wins of every opponent actually played. */
  buchholz: number;
}

const decided = (g: SwissGame) =>
  g.status === "completed" && g.scoreA !== null && g.scoreB !== null && g.scoreA !== g.scoreB;

/** The winner of a scored game, or null while it isn't one. */
export const winnerOf = (g: SwissGame): PairKey | null =>
  decided(g) ? (g.scoreA! > g.scoreB! ? g.a : g.b) : null;

const edge = (x: PairKey, y: PairKey) => (x < y ? `${x}#${y}` : `${y}#${x}`);

/**
 * Standings: wins (a bye is a win), then Buchholz, then point difference, then
 * points scored. The pair key settles a complete tie so the order — and so the
 * next draw — never depends on row order. A bye adds no points either way and
 * no opponent, so it counts in nobody's Buchholz but the bye pair's own wins.
 */
export function swissStandings(keys: readonly PairKey[], rounds: readonly SwissRound[]): SwissRow[] {
  const rows = new Map(keys.map((key) => [key, {
    key, wins: 0, losses: 0, byes: 0, pointsFor: 0, pointsAgainst: 0, buchholz: 0,
  }]));
  const opponents = new Map(keys.map((key) => [key, [] as PairKey[]]));
  for (const round of rounds) {
    if (round.bye && rows.has(round.bye)) {
      const row = rows.get(round.bye)!;
      row.wins++; row.byes++;
    }
    for (const g of round.games) {
      const a = rows.get(g.a), b = rows.get(g.b);
      const winner = winnerOf(g);
      if (!a || !b || !winner) continue;
      a.pointsFor += g.scoreA!; a.pointsAgainst += g.scoreB!;
      b.pointsFor += g.scoreB!; b.pointsAgainst += g.scoreA!;
      if (winner === g.a) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
      opponents.get(g.a)!.push(g.b);
      opponents.get(g.b)!.push(g.a);
    }
  }
  for (const row of rows.values()) {
    row.buchholz = opponents.get(row.key)!.reduce((sum, o) => sum + rows.get(o)!.wins, 0);
  }
  return [...rows.values()].sort((x, y) =>
    y.wins - x.wins ||
    y.buchholz - x.buchholz ||
    (y.pointsFor - y.pointsAgainst) - (x.pointsFor - x.pointsAgainst) ||
    y.pointsFor - x.pointsFor ||
    (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

export interface Draw {
  games: Array<{ a: PairKey; b: PairKey }>;
  bye: PairKey | null;
}

/**
 * Round 1 from an order: seeded (by pair rating, strongest first) or shuffled.
 * Top half plays bottom half — 1 v 5, 2 v 6, 3 v 7, 4 v 8 — the way a CS
 * Swiss stage opens. With an odd count the last pair in the order sits out.
 */
export function firstRound(order: readonly PairKey[]): Draw {
  const bye = order.length % 2 ? order[order.length - 1] : null;
  const rest = bye ? order.slice(0, -1) : [...order];
  const half = rest.length / 2;
  return { games: rest.slice(0, half).map((a, i) => ({ a, b: rest[i + half] })), bye };
}

/**
 * The next round, or null when no draw without a rematch exists.
 *
 * Every possible set of games is tried — at most 10,395 for twelve pairs — and
 * the best kept, by three costs in order:
 *
 * 1. Keep records together: the sum of squared win differences. Zero when every
 *    game is between pairs on the same record.
 * 2. When someone must move to another record group (an odd-sized group, or a
 *    rematch in the way), move them the shortest distance: rank difference
 *    summed over those games.
 * 3. Inside a group, highest against lowest, CS-style: minimizing the sum of
 *    rank products pairs 1 v 4 and 2 v 3 rather than 1 v 2 and 3 v 4.
 *
 * The bye goes to the lowest-ranked pair that hasn't had one, moving up only
 * if the rest then can't be drawn without a rematch.
 *
 * It also looks one round ahead. Six pairs after three rounds can be left with
 * two unplayed triangles — and no fourth round without a rematch — purely
 * because of which equally good draw was picked earlier. So among draws, one
 * that still leaves a next round is preferred; only if none does is the best
 * remaining draw taken (the organizer then has to go to the playoffs).
 */
export function nextRound(keys: readonly PairKey[], rounds: readonly SwissRound[]): Draw | null {
  const table = swissStandings(keys, rounds);
  const rank = new Map(table.map((r, i) => [r.key, i + 1]));
  const wins = new Map(table.map((r) => [r.key, r.wins]));
  const met = new Set<string>();
  const hadBye = new Set<PairKey>();
  for (const round of rounds) {
    if (round.bye) hadBye.add(round.bye);
    for (const g of round.games) met.add(edge(g.a, g.b));
  }

  const ordered = table.map((r) => r.key);
  const byeCandidates: Array<PairKey | null> = keys.length % 2
    ? [...ordered].reverse().filter((k) => !hadBye.has(k))
    : [null];

  const draw = (bye: PairKey | null, pairs: Array<[PairKey, PairKey]>): Draw => ({
    bye,
    games: pairs
      .map(([x, y]) => (rank.get(x)! < rank.get(y)! ? { a: x, b: y } : { a: y, b: x }))
      .sort((g, h) => rank.get(g.a)! - rank.get(h.a)!),
  });
  // A draw that leaves another round possible: some pair still without a bye
  // can sit out (odd counts), and everyone else can meet someone new.
  const leavesNext = (bye: PairKey | null) => (pairs: Array<[PairKey, PairKey]>) => {
    const after = new Set(met);
    for (const [x, y] of pairs) after.add(edge(x, y));
    const byes = new Set(hadBye);
    if (bye) byes.add(bye);
    const sitters: Array<PairKey | null> = keys.length % 2 ? ordered.filter((k) => !byes.has(k)) : [null];
    return sitters.some((k) => hasPerfectMatching(ordered.filter((x) => x !== k), after));
  };
  for (const bye of byeCandidates) {
    const pool = ordered.filter((k) => k !== bye);
    const best = bestMatching(pool, met, wins, rank, leavesNext(bye));
    if (best) return draw(bye, best);
  }
  for (const bye of byeCandidates) {
    const pool = ordered.filter((k) => k !== bye);
    const best = bestMatching(pool, met, wins, rank);
    if (best) return draw(bye, best);
  }
  return null;
}

function hasPerfectMatching(pool: readonly PairKey[], met: ReadonlySet<string>): boolean {
  const used = new Set<PairKey>();
  const search = (): boolean => {
    const first = pool.find((k) => !used.has(k));
    if (first === undefined) return true;
    used.add(first);
    for (const other of pool) {
      if (used.has(other) || met.has(edge(first, other))) continue;
      used.add(other);
      if (search()) { used.delete(other); used.delete(first); return true; }
      used.delete(other);
    }
    used.delete(first);
    return false;
  };
  return search();
}

type Cost = [number, number, number];
const lower = (x: Cost, y: Cost) => x[0] !== y[0] ? x[0] < y[0] : x[1] !== y[1] ? x[1] < y[1] : x[2] < y[2];

function bestMatching(
  pool: readonly PairKey[],
  met: ReadonlySet<string>,
  wins: ReadonlyMap<PairKey, number>,
  rank: ReadonlyMap<PairKey, number>,
  acceptable: (pairs: Array<[PairKey, PairKey]>) => boolean = () => true,
): Array<[PairKey, PairKey]> | null {
  let best: { pairs: Array<[PairKey, PairKey]>; cost: Cost } | null = null;
  const chosen: Array<[PairKey, PairKey]> = [];
  const used = new Set<PairKey>();

  const search = (cost: Cost) => {
    // Every cost only grows, so a partial draw already no better is a dead end.
    if (best && !lower(cost, best.cost)) return;
    const first = pool.find((k) => !used.has(k));
    if (first === undefined) {
      if (acceptable(chosen)) best = { pairs: [...chosen], cost };
      return;
    }
    used.add(first);
    for (const other of pool) {
      if (used.has(other) || met.has(edge(first, other))) continue;
      const dw = wins.get(first)! - wins.get(other)!;
      const rf = rank.get(first)!, ro = rank.get(other)!;
      used.add(other); chosen.push([first, other]);
      search([cost[0] + dw * dw, cost[1] + (dw ? Math.abs(rf - ro) : 0), cost[2] + (dw ? 0 : rf * ro)]);
      chosen.pop(); used.delete(other);
    }
    used.delete(first);
  };
  search([0, 0, 0]);
  return best === null ? null : (best as { pairs: Array<[PairKey, PairKey]> }).pairs;
}

// ---------------------------------------------------------------------------
// Playoffs: every pair plays two more games for a final place.
// ---------------------------------------------------------------------------

export type PlayoffKind = "semi" | "place" | "series" | "ladder";

export interface PlayoffGame {
  a: PairKey;
  b: PairKey;
  kind: PlayoffKind;
  /** The best place this game decides. */
  place: number;
  /** Semi-final 1/2, or the first/second game of a series or ladder. */
  leg: number;
}

export interface PlayoffShape {
  /** First place of each group of four: semi-finals, then two placement games. */
  groups: number[];
  /** First place of the last two pairs on a 6/10-pair night: two games against each other. */
  series: number | null;
  /** First place of the last three pairs on an odd night: a two-game ladder. */
  ladder: number | null;
}

/**
 * Groups of four from the top. An odd night's last three play a ladder; a
 * remaining two play each other twice. With an odd count one pair sits out
 * each playoff wave — there is no way around it with three pairs.
 */
export function playoffShape(pairs: number): PlayoffShape {
  const ladder = pairs % 2 ? pairs - 2 : null;
  const rest = pairs % 2 ? pairs - 3 : pairs;
  const groups: number[] = [];
  for (let start = 1; start + 3 <= rest; start += 4) groups.push(start);
  return { groups, series: rest % 4 === 2 ? rest - 1 : null, ladder };
}

/** The first playoff wave, from the final Swiss order (best first). */
export function playoffWave1(ranked: readonly PairKey[]): PlayoffGame[] {
  const shape = playoffShape(ranked.length);
  const at = (place: number) => ranked[place - 1];
  const games: PlayoffGame[] = [];
  for (const g of shape.groups) {
    games.push({ a: at(g), b: at(g + 3), kind: "semi", place: g, leg: 1 });
    games.push({ a: at(g + 1), b: at(g + 2), kind: "semi", place: g, leg: 2 });
  }
  if (shape.series) games.push({ a: at(shape.series), b: at(shape.series + 1), kind: "series", place: shape.series, leg: 1 });
  // The two lowest play first; the highest of the three waits for the winner.
  if (shape.ladder) games.push({ a: at(shape.ladder + 1), b: at(shape.ladder + 2), kind: "ladder", place: shape.ladder, leg: 1 });
  return games;
}

export type PlayedPlayoff = PlayoffGame & Pick<SwissGame, "scoreA" | "scoreB" | "status">;

const playoffWinner = (g: PlayedPlayoff) => winnerOf({ ...g });
const loserOf = (g: PlayedPlayoff) => {
  const w = playoffWinner(g);
  return w === null ? null : w === g.a ? g.b : g.a;
};

/** The second wave, once every first-wave game has a winner; else null. */
export function playoffWave2(ranked: readonly PairKey[], wave1: readonly PlayedPlayoff[]): PlayoffGame[] | null {
  if (wave1.some((g) => playoffWinner(g) === null)) return null;
  const shape = playoffShape(ranked.length);
  const find = (kind: PlayoffKind, place: number, leg: number) =>
    wave1.find((g) => g.kind === kind && g.place === place && g.leg === leg);
  const games: PlayoffGame[] = [];
  for (const g of shape.groups) {
    const s1 = find("semi", g, 1), s2 = find("semi", g, 2);
    if (!s1 || !s2) return null;
    games.push({ a: playoffWinner(s1)!, b: playoffWinner(s2)!, kind: "place", place: g, leg: 1 });
    games.push({ a: loserOf(s1)!, b: loserOf(s2)!, kind: "place", place: g + 2, leg: 1 });
  }
  if (shape.series) {
    const first = find("series", shape.series, 1);
    if (!first) return null;
    games.push({ a: first.a, b: first.b, kind: "series", place: shape.series, leg: 2 });
  }
  if (shape.ladder) {
    const first = find("ladder", shape.ladder, 1);
    if (!first) return null;
    games.push({ a: ranked[shape.ladder - 1], b: playoffWinner(first)!, kind: "ladder", place: shape.ladder, leg: 2 });
  }
  return games;
}

/**
 * Final places, best first, once every playoff game has a winner; else null.
 * A series split 1–1 goes to total points, then to the higher Swiss seed.
 */
export function finalPlaces(ranked: readonly PairKey[], games: readonly PlayedPlayoff[]): PairKey[] | null {
  if (games.some((g) => playoffWinner(g) === null)) return null;
  const shape = playoffShape(ranked.length);
  const place: PairKey[] = new Array(ranked.length);
  const find = (kind: PlayoffKind, p: number, leg: number) =>
    games.find((g) => g.kind === kind && g.place === p && g.leg === leg);
  for (const g of shape.groups) {
    const top = find("place", g, 1), bottom = find("place", g + 2, 1);
    if (!top || !bottom) return null;
    place[g - 1] = playoffWinner(top)!; place[g] = loserOf(top)!;
    place[g + 1] = playoffWinner(bottom)!; place[g + 2] = loserOf(bottom)!;
  }
  if (shape.series) {
    const legs = [find("series", shape.series, 1), find("series", shape.series, 2)];
    if (!legs[0] || !legs[1]) return null;
    const [x, y] = [ranked[shape.series - 1], ranked[shape.series]];
    const tally = (k: PairKey) => legs.reduce((sum, g) => ({
      won: sum.won + (playoffWinner(g!) === k ? 1 : 0),
      points: sum.points + (g!.a === k ? g!.scoreA! : g!.scoreB!),
    }), { won: 0, points: 0 });
    const tx = tally(x), ty = tally(y);
    const xFirst = tx.won !== ty.won ? tx.won > ty.won : tx.points !== ty.points ? tx.points > ty.points : true;
    place[shape.series - 1] = xFirst ? x : y;
    place[shape.series] = xFirst ? y : x;
  }
  if (shape.ladder) {
    const first = find("ladder", shape.ladder, 1), second = find("ladder", shape.ladder, 2);
    if (!first || !second) return null;
    place[shape.ladder - 1] = playoffWinner(second)!;
    place[shape.ladder] = loserOf(second)!;
    place[shape.ladder + 1] = loserOf(first)!;
  }
  return place.every(Boolean) ? place : null;
}

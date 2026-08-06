/**
 * Match-shaped statistics — everything the record screen shows, and nothing
 * about ratings.
 *
 * Pure and dependency-free so the interesting parts can be tested directly.
 * The head-to-head numbers in particular are easy to get subtly wrong: the
 * player appears on either side of a match, and forgetting that turns "who
 * beats me" into "who I play".
 */

export interface PlayedMatch {
  matchId: string;
  playedAt: Date;
  a1: string;
  a2: string;
  b1: string;
  b2: string;
  scoreA: number | null;
  scoreB: number | null;
}

/** One match from the subject player's point of view. */
export interface MyMatch {
  matchId: string;
  playedAt: Date;
  partnerId: string;
  opponentIds: [string, string];
  scoreFor: number;
  scoreAgainst: number;
  won: boolean;
  /** Positive when they won by that much. */
  margin: number;
}

export interface HeadToHead {
  playerId: string;
  games: number;
  wins: number;
  /** 0–1. */
  winRate: number;
}

export interface RecordSummary {
  matches: MyMatch[];
  played: number;
  won: number;
  lost: number;
  /** 0–1, or null with nothing decided yet. */
  winRate: number | null;
  pointsFor: number;
  pointsAgainst: number;
  /** Best and worst single results, by margin. */
  biggestWin: MyMatch | null;
  heaviestLoss: MyMatch | null;
  longestWinStreak: number;
  partners: HeadToHead[];
  opponents: HeadToHead[];
}

const rate = (wins: number, games: number) => (games > 0 ? wins / games : 0);

function bump(book: Map<string, { games: number; wins: number }>, id: string, won: boolean) {
  const e = book.get(id) ?? { games: 0, wins: 0 };
  e.games += 1;
  if (won) e.wins += 1;
  book.set(id, e);
}

const toList = (book: Map<string, { games: number; wins: number }>): HeadToHead[] =>
  [...book.entries()]
    .map(([playerId, e]) => ({ playerId, ...e, winRate: rate(e.wins, e.games) }))
    .sort((a, b) => b.games - a.games);

/** Everything the record screen needs, from one pass over the match list. */
export function summariseRecord(playerId: string, all: PlayedMatch[]): RecordSummary {
  const partners = new Map<string, { games: number; wins: number }>();
  const opponents = new Map<string, { games: number; wins: number }>();
  const matches: MyMatch[] = [];

  let won = 0;
  let lost = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  let streak = 0;
  let longestWinStreak = 0;

  const ordered = [...all].sort((x, y) => x.playedAt.getTime() - y.playedAt.getTime());

  for (const m of ordered) {
    // An unplayed or voided match has no result to count.
    if (m.scoreA === null || m.scoreB === null) continue;

    const onA = m.a1 === playerId || m.a2 === playerId;
    const onB = m.b1 === playerId || m.b2 === playerId;
    if (!onA && !onB) continue;

    const partnerId = onA ? (m.a1 === playerId ? m.a2 : m.a1) : m.b1 === playerId ? m.b2 : m.b1;
    const opponentIds = (onA ? [m.b1, m.b2] : [m.a1, m.a2]) as [string, string];
    const scoreFor = onA ? m.scoreA : m.scoreB;
    const scoreAgainst = onA ? m.scoreB : m.scoreA;
    const didWin = scoreFor > scoreAgainst;

    matches.push({
      matchId: m.matchId,
      playedAt: m.playedAt,
      partnerId,
      opponentIds,
      scoreFor,
      scoreAgainst,
      won: didWin,
      margin: scoreFor - scoreAgainst,
    });

    if (didWin) {
      won += 1;
      streak = streak >= 0 ? streak + 1 : 1;
      longestWinStreak = Math.max(longestWinStreak, streak);
    } else {
      lost += 1;
      streak = streak <= 0 ? streak - 1 : -1;
    }

    pointsFor += scoreFor;
    pointsAgainst += scoreAgainst;

    bump(partners, partnerId, didWin);
    for (const o of opponentIds) bump(opponents, o, didWin);
  }

  const wins = matches.filter((m) => m.won);
  const losses = matches.filter((m) => !m.won);

  return {
    matches,
    played: matches.length,
    won,
    lost,
    winRate: matches.length > 0 ? rate(won, matches.length) : null,
    pointsFor,
    pointsAgainst,
    biggestWin: wins.length
      ? wins.reduce((best, m) => (m.margin > best.margin ? m : best))
      : null,
    heaviestLoss: losses.length
      ? losses.reduce((worst, m) => (m.margin < worst.margin ? m : worst))
      : null,
    longestWinStreak,
    partners: toList(partners),
    opponents: toList(opponents),
  };
}

/**
 * How many games with someone before their number means anything.
 *
 * One game together is a coincidence, not a partnership. Three is still thin,
 * but it's the point where "we win when we play together" stops being noise in
 * a group this size — and waiting for more would leave the screen empty for
 * months.
 */
export const MIN_TOGETHER = 3;

const pickBy = (
  list: HeadToHead[],
  compare: (a: HeadToHead, b: HeadToHead) => number,
  /** Extra condition the claim itself has to satisfy to be true. */
  qualifies: (h: HeadToHead) => boolean = () => true,
): HeadToHead | null => {
  const eligible = list.filter((h) => h.games >= MIN_TOGETHER && qualifies(h));
  if (eligible.length === 0) return null;
  return [...eligible].sort(compare)[0];
};

/** The partner you win most with. Ties break toward more games together. */
export const bestPartner = (partners: HeadToHead[]): HeadToHead | null =>
  pickBy(partners, (a, b) => b.winRate - a.winRate || b.games - a.games);

/*
 * These two are labelled "Owns the head-to-head" and "Has their number", and
 * a label that names someone has to be true about them. Sorting alone isn't
 * enough: an unbeaten player's *worst* opponent is still someone they have
 * never lost to, and printing them as a nemesis states a defeat that never
 * happened. Each therefore has to actually hold a winning record.
 */

/** The opponent you beat most often — and do genuinely beat. */
export const favouriteOpponent = (opponents: HeadToHead[]): HeadToHead | null =>
  pickBy(
    opponents,
    (a, b) => b.winRate - a.winRate || b.games - a.games,
    (h) => h.wins * 2 > h.games,
  );

/** The one with your number: they have to be ahead of you, not merely least behind. */
export const nemesis = (opponents: HeadToHead[]): HeadToHead | null =>
  pickBy(
    opponents,
    (a, b) => a.winRate - b.winRate || b.games - a.games,
    (h) => h.wins * 2 < h.games,
  );

/**
 * Who you've shared a court with most, win or lose.
 *
 * Held to the same minimum as the rest. "Played most with X, at one game" is
 * not a fact about anybody, and the screen says underneath that everything on
 * it comes from three games or more — so this has to be true too.
 */
export const mostPlayedWith = (partners: HeadToHead[]): HeadToHead | null =>
  pickBy(partners, (a, b) => b.games - a.games || b.wins - a.wins);

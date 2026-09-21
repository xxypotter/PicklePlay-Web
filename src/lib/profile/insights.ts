/**
 * What a player's record says about how they play.
 *
 * Four questions, each answered only when there are enough games for the
 * answer to mean something:
 *
 *   - How do they do against stronger, even and weaker teams?
 *   - Are they playing better or worse lately?
 *   - Which format suits them?
 *   - How do they do when it is close?
 *
 * **Performance is measured against expectation, not by raw wins.** Going 3–0
 * with a strong partner says more about the partner than about you, and losing
 * to a much stronger team is not bad play. Each game is compared with the point
 * share the two teams' ratings predicted, so what is left is how the player
 * actually played. Ratings set the expectation here and are never displayed.
 *
 * The expectation always uses the *current* curve, including for games played
 * under an earlier one. This is a display measure, not a rating calculation, and
 * the older curve was measured to expect bigger margins than this group plays —
 * judged against it, twenty of twenty-two regulars "underperformed as the
 * favourite", which is the curve talking rather than the players.
 *
 * Pure, so the thresholds can be tested without a database.
 */
import { RATING } from "@/lib/rating/constants";
import { expectedShare } from "@/lib/rating/engine";

export interface InsightMatch {
  playedAt: Date;
  won: boolean;
  scoreFor: number;
  scoreAgainst: number;
  /** The session's format, or null for a match logged outside a session. */
  format: string | null;
  /** Team rating averages before the match. Null for a casual (unrated) game. */
  ours: number | null;
  theirs: number | null;
}

export interface Line {
  games: number;
  wins: number;
  /** Mean share of the points won, 0–1, over every game in the group. */
  share: number;
  /**
   * The expectation comparison, over the rated games in the group — both
   * figures from the same games, so they can be set against each other.
   * Null when none of the group's games were rated.
   */
  rated: { games: number; actual: number; expected: number } | null;
}

/** A rating gap inside this counts as an even match. */
export const EVEN_BAND = 0.15;
/** Fewest games before a split is shown. Below this it is noise. */
export const MIN_GROUP = 5;
/** Form needs enough games for both halves to mean something. */
export const FORM_MIN = 12;
export const FORM_RECENT = 10;
/** A game won or lost by this many points or fewer. */
export const CLOSE_MARGIN = 2;
export const MIN_CLOSE = 4;
/** Within this many percentage points, it is "about what was expected". */
export const ABOUT = 0.03;

const shareOf = (m: InsightMatch) => {
  const total = m.scoreFor + m.scoreAgainst;
  return total > 0 ? m.scoreFor / total : 0.5;
};

const isRated = (m: InsightMatch): m is InsightMatch & { ours: number; theirs: number } =>
  m.ours !== null && m.theirs !== null;

export function lineOf(ms: InsightMatch[]): Line {
  const wins = ms.filter((m) => m.won).length;
  const share = ms.length ? ms.reduce((s, m) => s + shareOf(m), 0) / ms.length : 0;

  const rated = ms.filter(isRated);
  return {
    games: ms.length,
    wins,
    share,
    rated: rated.length
      ? {
          games: rated.length,
          actual: rated.reduce((s, m) => s + shareOf(m), 0) / rated.length,
          expected:
            rated.reduce((s, m) => s + expectedShare(m.ours, m.theirs, RATING.D_POINTS), 0) /
            rated.length,
        }
      : null,
  };
}

export type Verdict = "above" | "about" | "below";

/** How a line compares with its expectation, in plain terms. */
export function verdict(line: Line): Verdict | null {
  if (!line.rated) return null;
  const diff = line.rated.actual - line.rated.expected;
  if (diff >= ABOUT) return "above";
  if (diff <= -ABOUT) return "below";
  return "about";
}

export interface StrengthSplit {
  stronger: Line | null;
  even: Line | null;
  weaker: Line | null;
}

/**
 * Against stronger, even and weaker teams — the question the page exists for.
 *
 * Grouped by the gap between the two team averages, from the player's side, so
 * "stronger" means the opponents were rated higher. Rated games only: a casual
 * night has no ratings to compare. Each group needs `MIN_GROUP` games; null if
 * none qualifies.
 */
export function strengthSplit(ms: InsightMatch[]): StrengthSplit | null {
  const rated = ms.filter(isRated);
  const group = (keep: (gap: number) => boolean) => {
    const g = rated.filter((m) => keep(m.ours - m.theirs));
    return g.length >= MIN_GROUP ? lineOf(g) : null;
  };

  const split = {
    stronger: group((gap) => gap < -EVEN_BAND),
    even: group((gap) => Math.abs(gap) <= EVEN_BAND),
    weaker: group((gap) => gap > EVEN_BAND),
  };

  return split.stronger || split.even || split.weaker ? split : null;
}

export interface Form {
  recent: Line;
  earlier: Line;
  trend: "up" | "down" | "flat";
}

/**
 * Recent games against everything before them.
 *
 * The last ten, or half the record if that is smaller, so a player with twelve
 * games still gets two halves of six. Called on win rate, the number everyone
 * already understands: ten points either way is a change worth mentioning.
 */
export function form(ms: InsightMatch[]): Form | null {
  if (ms.length < FORM_MIN) return null;

  const sorted = [...ms].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
  const cut = Math.min(FORM_RECENT, Math.floor(sorted.length / 2));
  const recent = lineOf(sorted.slice(-cut));
  const earlier = lineOf(sorted.slice(0, -cut));

  const change = recent.wins / recent.games - earlier.wins / earlier.games;
  return { recent, earlier, trend: change >= 0.1 ? "up" : change <= -0.1 ? "down" : "flat" };
}

/**
 * Results by format — only worth showing where there is a comparison to make.
 *
 * Each format needs `MIN_GROUP` games, and the whole section needs at least two
 * formats that clear it: one format on its own is just the overall record again.
 */
export function byFormat(ms: InsightMatch[]): Array<{ format: string; line: Line }> | null {
  const groups = new Map<string, InsightMatch[]>();
  for (const m of ms) {
    if (!m.format) continue;
    groups.set(m.format, [...(groups.get(m.format) ?? []), m]);
  }

  const rows = [...groups.entries()]
    .filter(([, g]) => g.length >= MIN_GROUP)
    .map(([format, g]) => ({ format, line: lineOf(g) }))
    .sort((a, b) => b.line.games - a.line.games);

  return rows.length >= 2 ? rows : null;
}

export interface CloseGames {
  games: number;
  wins: number;
  /** Win rate over the whole record, for comparison. */
  overall: number;
}

/**
 * Games decided by two points or fewer, set against the whole record — which
 * is what says whether someone is better or worse when it is tight.
 */
export function closeGames(ms: InsightMatch[]): CloseGames | null {
  const close = ms.filter((m) => Math.abs(m.scoreFor - m.scoreAgainst) <= CLOSE_MARGIN);
  if (close.length < MIN_CLOSE || ms.length === 0) return null;
  return {
    games: close.length,
    wins: close.filter((m) => m.won).length,
    overall: ms.filter((m) => m.won).length / ms.length,
  };
}

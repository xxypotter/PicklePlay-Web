/**
 * Who is listed on Rankings, decided when the page is viewed (v2.3).
 *
 * Display only. Nothing here touches a rating, so no tuning epoch is needed.
 *
 * - Reliability *earned here* decides it: the lowest of the partner, team and
 *   volume terms, never the typed DUPR floor. A DUPR number typed at signup
 *   put players with no games here at #1 and #3; it still seeds their rating
 *   and its K, but it does not list them.
 * - Evaluated now, not at the last rebuild. The recompute stores each player's
 *   evidence totals as of its timeline end; every term decays on the same
 *   half-life, so the totals today are those totals times one factor. Before,
 *   membership only changed when someone scored a game, and people vanished
 *   in batches.
 * - Enter at 60%, stay until 50% (RANKINGS). The hold state comes from the
 *   replay (engine updateRankHold), which sees every crossing up to the
 *   timeline end; after that, earned reliability can only decay, so falling
 *   under the hold line is the only further change, and that is checked here.
 */
import { RANKINGS, RATING, tuningFor } from "./constants";
import { decayFactor, earnedFromTotals } from "./engine";

export interface RankingEvidence {
  partners: number;
  teams: number;
  volume: number;
  /** When the totals were evaluated (the recompute's timeline end); null if never computed. */
  atMs: number | null;
  hold: boolean;
}

/** Earned reliability at `nowMs`, 0–1. */
export function earnedNow(e: RankingEvidence, nowMs: number): number {
  if (e.atMs === null) return 0;
  const d = nowMs > e.atMs ? decayFactor(e.atMs, nowMs, RATING.MATCH_HALF_LIFE_DAYS) : 1;
  return earnedFromTotals(e.partners * d, e.teams * d, e.volume * d, tuningFor(new Date(nowMs)));
}

/** Listed on Rankings at `nowMs`: reached 60% here, or listed before and still at 50% or more. */
export function isRanked(e: RankingEvidence, nowMs: number): boolean {
  const earned = earnedNow(e, nowMs);
  return earned >= RANKINGS.ENTER || (e.hold && earned >= RANKINGS.HOLD);
}

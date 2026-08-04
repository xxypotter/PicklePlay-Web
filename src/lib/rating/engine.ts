/**
 * PicklePlay Rating (PPR) engine — SPEC.md §5.
 *
 * Pure and dependency-free on purpose: no database, no Next.js, no clock reads.
 * Everything is a function of the event timeline you hand it, which is what
 * makes the whole-history recompute (§5.6) safe and the tests exact.
 *
 * This is a simulation of DUPR's *observable behavior*, not DUPR's formula
 * (which is proprietary and unpublished). See §5.1 for the behaviors it
 * reproduces and §5.5 for the worked examples the test suite asserts.
 */
import { RATING } from "./constants";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Timeline events
// ---------------------------------------------------------------------------

export interface SeedEvent {
  kind: "seed";
  at: Date;
  playerId: string;
  /** Declared rating — a real DUPR, a skill-picker value, or an admin override. */
  rating: number;
  /** Declared reliability, 0-100. Converts to imported evidence (§5.7). */
  declaredReliability: number;
  /** True for the signup seed, false for a monthly re-seed (§5.8). Display only. */
  isInitial: boolean;
}

export interface MatchEvent {
  kind: "match";
  at: Date;
  matchId: string;
  teamA: readonly [string, string];
  teamB: readonly [string, string];
  scoreA: number;
  scoreB: number;
}

export type TimelineEvent = SeedEvent | MatchEvent;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface PlayerRating {
  playerId: string;
  rating: number;
  peakRating: number;
  /** 0-1. Multiply by 100 for display. */
  reliability: number;
  halfLife: number;
  /** Matches played in this group, ignoring anything self-declared. */
  localMatches: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Positive for a win streak, negative for a losing streak. */
  streak: number;
  provisional: boolean;
  /** True until the player has enough local matches to stand on their own. */
  selfDeclared: boolean;
  lastPlayedAt: Date | null;
}

export interface RatingChange {
  matchId: string;
  playerId: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  k: number;
  surprise: number;
  reliabilityAtTime: number;
}

export interface RecomputeResult {
  players: Map<string, PlayerRating>;
  changes: RatingChange[];
}

// ---------------------------------------------------------------------------
// Core math (§5.3) — exported individually so the spec's worked examples can
// be asserted directly, without standing up a whole timeline.
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Elo-style logistic expectation. `d` controls the spread: smaller `d` means a
 * given rating gap implies a more lopsided result.
 */
export function expectedShare(teamRating: number, oppRating: number, d: number): number {
  return 1 / (1 + Math.pow(10, (oppRating - teamRating) / d));
}

/**
 * How surprising this result was, from team A's point of view (§5.3 step 2).
 * Positive means A did better than their rating predicted. Team B's surprise is
 * exactly the negation.
 *
 * Blending two curves is what produces DUPR's signature quirks: a heavy
 * favorite can *lose* rating by winning narrowly, and an underdog can *gain* by
 * losing narrowly.
 */
export function matchSurprise(
  teamA: number,
  teamB: number,
  scoreA: number,
  scoreB: number,
): number {
  const eP = expectedShare(teamA, teamB, RATING.D_POINTS);
  const eW = expectedShare(teamA, teamB, RATING.D_WIN);
  const expected = RATING.ALPHA * eP + (1 - RATING.ALPHA) * eW;

  const total = scoreA + scoreB;
  const share = total > 0 ? scoreA / total : 0.5;
  const won = scoreA > scoreB ? 1 : 0;
  const actual = RATING.ALPHA * share + (1 - RATING.ALPHA) * won;

  return actual - expected;
}

/**
 * Shrink movement near the floor and ceiling (§5.3 step 4), so climbing the
 * last stretch to 8.0 is progressively harder than moving through the middle.
 */
export function compression(rating: number, gaining: boolean): number {
  const room = gaining ? RATING.MAX - rating : rating - RATING.MIN;
  return Math.sqrt(clamp(room / RATING.COMPRESS_BAND, 0, 1));
}

/** Per-player K (§5.3 step 3). Lower reliability means faster movement. */
export function kFactor(reliability: number, localMatches: number): number {
  let k = RATING.K_RELIABLE + (RATING.K_NEW - RATING.K_RELIABLE) * (1 - reliability);
  if (localMatches < RATING.CAL_MATCHES) k *= RATING.CAL_MULT;
  if (localMatches < RATING.SEED_FLOOR_MATCHES) k = Math.max(k, RATING.K_SEED_FLOOR);
  return k;
}

/** Apply K, compression, and the per-match cap to a raw surprise (§5.3 step 5). */
export function ratingDelta(
  rating: number,
  k: number,
  surprise: number,
  provisional: boolean,
): number {
  const raw = k * surprise * compression(rating, surprise > 0);
  const cap = provisional ? RATING.CAP_PROVISIONAL : RATING.CAP_RELIABLE;
  return clamp(raw, -cap, cap);
}

// ---------------------------------------------------------------------------
// Evidence and reliability (§5.4)
// ---------------------------------------------------------------------------

interface State {
  rating: number;
  peak: number;
  /** Timestamps of local matches, used for the decayed half-life sum. */
  matchTimes: number[];
  opponents: Set<string>;
  localMatches: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  streak: number;
  lastPlayedMs: number | null;
}

/**
 * Weight of a single result that is `daysAgo` days old.
 *
 * With the default 90-day half-life, 3 results today, 6 results from 90 days
 * ago, and 12 from 180 days ago all sum to the same 3.0 — DUPR's documented
 * rule that the number of results needed doubles every 90 days.
 */
export function evidenceWeight(
  daysAgo: number,
  halfLifeDays: number = RATING.MATCH_HALF_LIFE_DAYS,
): number {
  return Math.pow(0.5, daysAgo / halfLifeDays);
}

const decayFactor = (fromMs: number, toMs: number, halfLifeDays: number) =>
  evidenceWeight((toMs - fromMs) / DAY_MS, halfLifeDays);

/** Weighted count of how much *live* evidence we have about a player. */
/**
 * Only matches played here count as evidence.
 *
 * A self-declared rating used to buy up to 8 half-lives and 8 opponents, which
 * put a player who had never played at 0.6*(8/10) + 0.4*(8/8) = 88% reliable —
 * past the 60% threshold, so their K-factor was already down at the "settled"
 * end. That got it backwards: the least verified number in the system was the
 * hardest one to correct, and a conservative self-assessment was punished with
 * a lower reliability than an ambitious one.
 *
 * DUPR's reliability is explicitly about logged results, how recently you
 * played, and who you played against. A self-posted claim can't make you
 * reliable there, so it doesn't here either — the declared rating still says
 * where you start, it just no longer claims to be evidence.
 */
function halfLifeAt(state: State, nowMs: number): number {
  let hl = 0;
  for (const t of state.matchTimes) {
    hl += decayFactor(t, nowMs, RATING.MATCH_HALF_LIFE_DAYS);
  }
  return hl;
}

function reliabilityAt(state: State, nowMs: number): number {
  const hl = halfLifeAt(state, nowMs);
  return (
    RATING.W_HALF_LIFE * Math.min(1, hl / RATING.HL_FULL) +
    RATING.W_OPPONENTS * Math.min(1, state.opponents.size / RATING.OPPONENTS_FULL)
  );
}

const isProvisional = (halfLife: number, reliability: number) =>
  halfLife < RATING.HL_RELIABLE || reliability < RATING.RELIABILITY_PASS;

// ---------------------------------------------------------------------------
// Whole-history recompute (§5.6)
// ---------------------------------------------------------------------------

function newState(rating: number): State {
  return {
    rating,
    peak: rating,
    matchTimes: [],
    opponents: new Set(),
    localMatches: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    streak: 0,
    lastPlayedMs: null,
  };
}

function runPass(events: TimelineEvent[]): RecomputeResult {
  const states = new Map<string, State>();
  const changes: RatingChange[] = [];

  const stateFor = (playerId: string): State => {
    let s = states.get(playerId);
    if (!s) {
      s = newState(RATING.DEFAULT_RATING);
      states.set(playerId, s);
    }
    return s;
  };

  for (const event of events) {
    const atMs = event.at.getTime();

    // A seed moves where a player starts. It buys no evidence — see
    // halfLifeAt — so an unplayed player stays provisional with a fast K and
    // their first real matches carry them to their actual level.
    if (event.kind === "seed") {
      const s = stateFor(event.playerId);
      s.rating = clamp(event.rating, RATING.MIN, RATING.MAX);
      s.peak = Math.max(s.peak, s.rating);
      continue;
    }

    const ids = [...event.teamA, ...event.teamB] as const;
    const st = ids.map(stateFor);
    const [a1, a2, b1, b2] = st;

    const teamA = (a1.rating + a2.rating) / 2;
    const teamB = (b1.rating + b2.rating) / 2;
    const surpriseA = matchSurprise(teamA, teamB, event.scoreA, event.scoreB);

    // Every delta is computed from the pre-match ratings, then applied — so
    // partner order within a match can never change the outcome.
    const pending = st.map((s, i) => {
      const onTeamA = i < 2;
      const surprise = onTeamA ? surpriseA : -surpriseA;
      const reliability = reliabilityAt(s, atMs);
      const halfLife = halfLifeAt(s, atMs);
      const k = kFactor(reliability, s.localMatches);
      const delta = ratingDelta(s.rating, k, surprise, isProvisional(halfLife, reliability));
      return { surprise, reliability, k, delta, before: s.rating };
    });

    const aWon = event.scoreA > event.scoreB;

    st.forEach((s, i) => {
      const p = pending[i];
      const onTeamA = i < 2;
      const won = onTeamA === aWon;
      const after = clamp(p.before + p.delta, RATING.MIN, RATING.MAX);

      s.rating = after;
      s.peak = Math.max(s.peak, after);
      s.matchTimes.push(atMs);
      s.localMatches += 1;
      s.lastPlayedMs = atMs;

      const opponents = onTeamA ? event.teamB : event.teamA;
      for (const opp of opponents) s.opponents.add(opp);

      if (won) {
        s.wins += 1;
        s.streak = s.streak >= 0 ? s.streak + 1 : 1;
      } else {
        s.losses += 1;
        s.streak = s.streak <= 0 ? s.streak - 1 : -1;
      }
      s.pointsFor += onTeamA ? event.scoreA : event.scoreB;
      s.pointsAgainst += onTeamA ? event.scoreB : event.scoreA;

      changes.push({
        matchId: event.matchId,
        playerId: ids[i],
        ratingBefore: p.before,
        ratingAfter: after,
        delta: after - p.before,
        k: p.k,
        surprise: p.surprise,
        reliabilityAtTime: p.reliability,
      });
    });
  }

  // Reliability is reported as of the last event in the timeline, so a player
  // who stopped showing up decays toward provisional rather than freezing.
  const endMs = events.length ? events[events.length - 1].at.getTime() : Date.now();

  const players = new Map<string, PlayerRating>();
  for (const [playerId, s] of states) {
    const halfLife = halfLifeAt(s, endMs);
    const reliability = reliabilityAt(s, endMs);
    players.set(playerId, {
      playerId,
      rating: s.rating,
      peakRating: s.peak,
      reliability,
      halfLife,
      localMatches: s.localMatches,
      wins: s.wins,
      losses: s.losses,
      pointsFor: s.pointsFor,
      pointsAgainst: s.pointsAgainst,
      streak: s.streak,
      provisional: isProvisional(halfLife, reliability),
      selfDeclared: s.localMatches < RATING.SEED_FLOOR_MATCHES,
      lastPlayedAt: s.lastPlayedMs === null ? null : new Date(s.lastPlayedMs),
    });
  }

  return { players, changes };
}

/**
 * Replay the entire history and rebuild every rating from scratch.
 *
 * Single chronological pass. Events may be supplied in any order; they are
 * sorted here, so the result depends only on the *content* of the history.
 *
 * An earlier draft of this engine ran the replay several times, feeding each
 * pass the previous pass's final ratings, on the theory that late information
 * should flow backward and re-score your first match once we knew how strong
 * that opponent really was. The convergence test proved that wrong: iterating
 * an Elo-style online updater does not settle on a better estimate, it drifts
 * toward the degenerate fixed point where the season's net movement is zero —
 * which erases exactly the within-season improvement the rating exists to show.
 * (4 passes vs. 8 diverged by 0.11 on a 20-match season.)
 *
 * Getting that benefit properly needs Whole-History Rating, which fits a rating
 * *curve* per player rather than iterating point estimates. That's a worthwhile
 * upgrade later; it is not a constant to tweak. One pass is correct today.
 */
export function recompute(events: TimelineEvent[]): RecomputeResult {
  const sorted = [...events].sort((a, b) => {
    const d = a.at.getTime() - b.at.getTime();
    if (d !== 0) return d;
    // Seeds settle before matches at the same instant, so a player who signs up
    // and immediately plays is rated from their declared value, not the default.
    if (a.kind !== b.kind) return a.kind === "seed" ? -1 : 1;
    return 0;
  });

  return runPass(sorted);
}

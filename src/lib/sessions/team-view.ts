/**
 * Reading a fixed-partner night as teams rather than as players.
 *
 * A round robin ranks individuals, because partners change every round and the
 * only thing that survives the night is you. Fixed partners is the opposite: the
 * pair is the competitor, and a table of eight separate names hides the one fact
 * that matters — who was playing with whom. It also puts the medal on the wrong
 * row, since the gold belongs to *both* halves of the team that won it.
 *
 * Derived from the rounds the page already has, so this costs no extra queries.
 * Pure, so the placement rules can be tested without a session.
 */
import { teamKey } from "./medal";
import type { CurrentRound, RoundMatch, RoundPlayer } from "./queries";

export interface TeamRow {
  /** Stable id for the pair, both player ids in sorted order. */
  team: string;
  players: RoundPlayer[];
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Each player's rating movement tonight, kept separate — rating is personal. */
  deltas: Array<{ id: string; username: string; delta: number | null }>;
  /** 1–4 once the medal round is played, otherwise null. */
  placement: number | null;
}

export interface BracketMatch {
  label: "semi1" | "semi2" | "gold" | "bronze";
  teamA: RoundPlayer[];
  teamB: RoundPlayer[];
  scoreA: number | null;
  scoreB: number | null;
  completed: boolean;
}

export interface Bracket {
  semis: BracketMatch[];
  /** Gold first, bronze second. Empty until the finals are drawn. */
  finals: BracketMatch[];
}

const playable = (m: RoundMatch) => !m.voided && m.teamA.length === 2 && m.teamB.length === 2;

/**
 * The bracket, or null if this night has no medal round.
 *
 * Court order carries the draw — the first semi-final is the top seed's, and
 * gold sits on court one — so the labels come from position rather than being
 * stored. That is the same convention the round builder writes with.
 */
export function bracketFrom(rounds: CurrentRound[]): Bracket | null {
  const semiRound = rounds.find((r) => r.stage === "semifinal");
  if (!semiRound) return null;

  const finalRound = rounds.find((r) => r.stage === "final");

  const toMatch = (m: RoundMatch, label: BracketMatch["label"]): BracketMatch => ({
    label,
    teamA: m.teamA,
    teamB: m.teamB,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    completed: m.completed && !m.voided,
  });

  const semis = semiRound.matches
    .slice(0, 2)
    .map((m, i) => ({ m, i })).filter(({ m }) => playable(m))
    .map(({ m, i }) => toMatch(m, i === 0 ? "semi1" : "semi2"));

  const finals = (finalRound?.matches ?? [])
    .slice(0, 2)
    .map((m, i) => ({ m, i })).filter(({ m }) => playable(m))
    .map(({ m, i }) => toMatch(m, i === 0 ? "gold" : "bronze"));

  return { semis, finals };
}

/** Who finished where, once the finals are in. Keyed by team. */
function placementsFrom(bracket: Bracket | null): Map<string, number> {
  const places = new Map<string, number>();
  if (!bracket) return places;

  for (const match of bracket.finals) {
    if (!match.completed || match.scoreA === null || match.scoreB === null) continue;
    const aWon = match.scoreA > match.scoreB;
    const winner = teamKey(
      (aWon ? match.teamA : match.teamB)[0].id,
      (aWon ? match.teamA : match.teamB)[1].id,
    );
    const loser = teamKey(
      (aWon ? match.teamB : match.teamA)[0].id,
      (aWon ? match.teamB : match.teamA)[1].id,
    );
    // Gold decides first and second; bronze decides third and fourth.
    const base = match.label === "gold" ? 1 : 3;
    places.set(winner, base);
    places.set(loser, base + 1);
  }

  return places;
}

/**
 * The night as a team table.
 *
 * Ordered by **final placement first** where a medal round decided one, then by
 * record. Without that the medal lands on whoever had the best record, which on
 * a real night was a team that finished fourth — a table where the gold medal
 * sits beside somebody who lost the bronze match is worse than no medal at all.
 */
export function teamRowsFrom(
  rounds: CurrentRound[],
  deltaOf: ReadonlyMap<string, number | null>,
): TeamRow[] {
  const bracket = bracketFrom(rounds);
  const places = placementsFrom(bracket);
  const table = new Map<string, TeamRow>();

  const row = (players: RoundPlayer[]): TeamRow => {
    const key = teamKey(players[0].id, players[1].id);
    let found = table.get(key);
    if (!found) {
      /*
       * Displayed by name, not by id. The key stays id-based because it has to
       * be stable, but "dev_dev + dev_cara" reads as though somebody shuffled
       * it; people expect their pair written the same way every time.
       */
      const ordered = [...players].sort((a, b) => a.username.localeCompare(b.username));
      found = {
        team: key,
        players: ordered,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        deltas: ordered.map((p) => ({
          id: p.id,
          username: p.username,
          delta: deltaOf.get(p.id) ?? null,
        })),
        placement: places.get(key) ?? null,
      };
      table.set(key, found);
    }
    return found;
  };

  for (const round of rounds) {
    for (const m of round.matches) {
      if (!playable(m) || !m.completed || m.scoreA === null || m.scoreB === null) continue;
      const a = row(m.teamA);
      const b = row(m.teamB);
      const aWon = m.scoreA > m.scoreB;

      if (aWon) {
        a.wins += 1;
        b.losses += 1;
      } else {
        b.wins += 1;
        a.losses += 1;
      }
      a.pointsFor += m.scoreA;
      a.pointsAgainst += m.scoreB;
      b.pointsFor += m.scoreB;
      b.pointsAgainst += m.scoreA;
    }
  }

  // Teams drawn into a bracket but not yet finished still belong in the table,
  // so a scheduled semi-final does not make a pair vanish from the standings.
  if (bracket) {
    for (const m of [...bracket.semis, ...bracket.finals]) {
      row(m.teamA);
      row(m.teamB);
    }
  }

  return [...table.values()].sort((x, y) => {
    if (x.placement !== null || y.placement !== null) {
      // Anyone placed outranks anyone unplaced.
      if (x.placement === null) return 1;
      if (y.placement === null) return -1;
      if (x.placement !== y.placement) return x.placement - y.placement;
    }
    return (
      y.wins - x.wins ||
      y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst) ||
      y.pointsFor - x.pointsFor ||
      (x.team < y.team ? -1 : x.team > y.team ? 1 : 0)
    );
  });
}

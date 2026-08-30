/**
 * The medal round — how a fixed-partner night finishes.
 *
 * After the round robin the top four teams play off: 1 v 4 and 2 v 3, then the
 * two winners meet for gold and the two losers for bronze. Teams ranked fifth
 * and below are done; a placement match for them is a different feature and
 * nobody asked for one.
 *
 * Pure, so the seeding can be tested against fixtures rather than by standing
 * up a session. Everything here is derived from matches that were actually
 * played, never from the signup rows: pairs can be edited between rounds, and
 * the bracket has to reflect the night that happened.
 */

/** A team, identified by its two player ids in a stable order. */
export type TeamKey = string;

export const teamKey = (a: string, b: string): TeamKey =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

export const teamPlayers = (key: TeamKey): [string, string] =>
  key.split("|") as [string, string];

/** One completed match, as the seeding cares about it. */
export interface PlayedMatch {
  a1: string;
  a2: string;
  b1: string;
  b2: string;
  scoreA: number;
  scoreB: number;
}

export interface TeamStanding {
  team: TeamKey;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

/**
 * Team standings from the round-robin results.
 *
 * Ordered the same way the player standings are — wins, then point difference —
 * so the bracket agrees with the table everyone has been looking at all night.
 * Points scored breaks a remaining tie, and the team key breaks the last one so
 * the seeding is deterministic rather than dependent on row order.
 */
export function teamStandings(played: PlayedMatch[]): TeamStanding[] {
  const table = new Map<TeamKey, TeamStanding>();

  const row = (key: TeamKey) => {
    let found = table.get(key);
    if (!found) {
      found = { team: key, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
      table.set(key, found);
    }
    return found;
  };

  for (const m of played) {
    const a = row(teamKey(m.a1, m.a2));
    const b = row(teamKey(m.b1, m.b2));
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

  return [...table.values()].sort(
    (x, y) =>
      y.wins - x.wins ||
      y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst) ||
      y.pointsFor - x.pointsFor ||
      (x.team < y.team ? -1 : x.team > y.team ? 1 : 0),
  );
}

/** The four players of a match, team A first. */
export type Pairing = [string, string, string, string];

/**
 * The semi-finals: first seed plays fourth, second plays third.
 *
 * Court order is the bracket order and is load bearing — the finals read it
 * back to work out who met whom, and the labels shown to players ("Semi-final
 * 1") are derived from it rather than stored.
 */
export function semiFinals(standings: TeamStanding[]): [Pairing, Pairing] | null {
  if (standings.length < 4) return null;
  const [one, two, three, four] = standings.slice(0, 4).map((s) => teamPlayers(s.team));
  return [
    [one[0], one[1], four[0], four[1]],
    [two[0], two[1], three[0], three[1]],
  ];
}

/** Who won and who lost a completed match, as team keys. */
function outcome(m: PlayedMatch): { winner: TeamKey; loser: TeamKey } {
  const a = teamKey(m.a1, m.a2);
  const b = teamKey(m.b1, m.b2);
  return m.scoreA > m.scoreB ? { winner: a, loser: b } : { winner: b, loser: a };
}

/**
 * Gold and bronze, in that order.
 *
 * The two semi-final winners play for gold and the two losers for bronze —
 * which is the point of playing the losers off at all, rather than sending them
 * home to share third place.
 *
 * Takes the semi-finals in court order so the higher seed's side of the bracket
 * stays on court one through the final.
 */
export function finals(semis: [PlayedMatch, PlayedMatch]): [Pairing, Pairing] {
  const [first, second] = semis.map(outcome);
  const pair = (x: TeamKey, y: TeamKey): Pairing => {
    const [x1, x2] = teamPlayers(x);
    const [y1, y2] = teamPlayers(y);
    return [x1, x2, y1, y2];
  };
  return [pair(first.winner, second.winner), pair(first.loser, second.loser)];
}

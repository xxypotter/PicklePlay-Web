/** Mini MLP house rules. No database or UI dependencies. */
export const MLP_TEAM_COUNTS = [4, 5, 6] as const;
export type TeamCount = (typeof MLP_TEAM_COUNTS)[number];
export const MLP_MIN_COURTS = 4;
export const MLP_MAX_COURTS = 6;
export const validTeamCount = (count: number): count is TeamCount =>
  MLP_TEAM_COUNTS.some(n => n === count);
export const validMlpConfig = (courts: number, players: number) =>
  Number.isInteger(courts) && courts >= MLP_MIN_COURTS && courts <= MLP_MAX_COURTS && validTeamCount(players / 4);
export const encounterCount = (teams: number) => teams * (teams - 1) / 2;
// Persisted game/slot names remain compatible with the original v1.7 schema.
// They identify lineup positions, never a required player gender.
export const GAME_KINDS = ["women", "men", "mixed1", "mixed2"] as const;
export type GameKind = (typeof GAME_KINDS)[number];
export type Stage = "robin" | "semifinal" | "final";
export const OPENING_SLOTS = ["women1", "women2", "men1", "men2"] as const;
export interface Team {
  id: string; slot: number; name: string;
  /** Fixed mixed pairs: m1+w1 and m2+w2; no gender restrictions. */
  m1: string; m2: string; w1: string; w2: string;
  /** Explicit opening pairs. Null/absent only on draws created before this fix. */
  women1?: string | null; women2?: string | null;
  men1?: string | null; men2?: string | null;
}
export type TeamInput = Omit<Team, "id" | "slot">;
export const members = (t: TeamInput) => [t.m1, t.m2, t.w1, t.w2];
export interface Game {
  kind: string | null;
  scoreA: number | null; scoreB: number | null;
  status: "scheduled" | "completed" | "void";
}
export interface Encounter {
  id: string; index: number; block: number; stage: Stage;
  teamAId: string; teamBId: string; tiebreakWinner: string | null;
  decisionNote?: string | null;
  mixedCrossed?: boolean;
  games: Game[];
}

/** Only complete encounters decide team wins; a void needs resolution too. */
export function outcome(tie: Encounter) {
  let winsA = 0, winsB = 0, pointsA = 0, pointsB = 0;
  const valid = tie.games.filter(g => g.status === "completed" &&
    Number.isInteger(g.scoreA) && Number.isInteger(g.scoreB) &&
    g.scoreA! >= 0 && g.scoreB! >= 0 && g.scoreA! <= 99 && g.scoreB! <= 99 && g.scoreA !== g.scoreB);
  for (const g of valid) {
    pointsA += g.scoreA!; pointsB += g.scoreB!;
    if (g.scoreA! > g.scoreB!) winsA++; else winsB++;
  }
  const complete = tie.games.length === 4 && valid.length === 4 &&
    GAME_KINDS.every(k => valid.filter(g => g.kind === k).length === 1);
  let winner: string | null = null;
  let reason: "games" | "points" | "organizer" | "draw" | "tied" | "pending" = "pending";
  if (complete) {
    if (winsA !== winsB) { winner = winsA > winsB ? tie.teamAId : tie.teamBId; reason = "games"; }
    else if (pointsA !== pointsB) { winner = pointsA > pointsB ? tie.teamAId : tie.teamBId; reason = "points"; }
    else if ([tie.teamAId, tie.teamBId].includes(tie.tiebreakWinner ?? "")) {
      winner = tie.tiebreakWinner; reason = "organizer";
    } else if (tie.stage === "robin") reason = "draw";
    else reason = "tied";
  }
  return { complete, winner, reason, draw: reason === "draw", resolved: !!winner || reason === "draw", winsA, winsB, pointsA, pointsB };
}

export function standings(teams: Team[], ties: Encounter[]) {
  const rows = new Map(teams.map(team => [team.id, {
    team, played: 0, wins: 0, losses: 0, draws: 0, points: 0, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0,
  }]));
  for (const tie of ties.filter(t => t.stage === "robin")) {
    const a = rows.get(tie.teamAId), b = rows.get(tie.teamBId);
    if (!a || !b) continue;
    const result = outcome(tie);
    a.gamesWon += result.winsA; a.gamesLost += result.winsB;
    b.gamesWon += result.winsB; b.gamesLost += result.winsA;
    a.pointsFor += result.pointsA; a.pointsAgainst += result.pointsB;
    b.pointsFor += result.pointsB; b.pointsAgainst += result.pointsA;
    if (result.resolved) {
      a.played++; b.played++;
      if (result.draw) { a.draws++; b.draws++; a.points++; b.points++; }
      else if (result.winner === a.team.id) { a.wins++; b.losses++; a.points+=2; }
      else { b.wins++; a.losses++; b.points+=2; }
    }
  }
  return [...rows.values()].sort((a,b) => b.points-a.points ||
    (b.gamesWon-b.gamesLost)-(a.gamesWon-a.gamesLost) ||
    (b.pointsFor-b.pointsAgainst)-(a.pointsFor-a.pointsAgainst) ||
    b.pointsFor-a.pointsFor || a.team.slot-b.team.slot);
}

/** Minimum eight two-court blocks for 15 encounters, every pairing exactly once.
 * Each entry uses courts 1–2, then 3–4. Two waves per block; no team double-books.
 * Explicit verified design avoids a heuristic missing or repeating an edge.
 *
 * Rest-balanced. Every team plays five of the eight blocks, and this order
 * spreads the three rests so nobody plays more than two blocks (four games) in
 * a row and nobody waits more than one block. Two in a row is the floor: five
 * games cannot strictly alternate across eight blocks. Found by exhaustive
 * search; the earlier order sent the third team entered through four blocks —
 * eight games — without a break, while others rested every other block.
 * Only the order changed, so existing draws are untouched: they are stored,
 * never regenerated from this table.
 */
const SIX_TEAM_BLOCKS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0,1],[2,3]], [[0,4],[1,5]], [[2,4],[3,5]], [[0,2],[1,3]],
  [[0,5],[1,4]], [[2,5],[3,4]], [[0,3],[1,2]], [[4,5]],
];

/** Four/five-team complete round robins; five teams have one bye per block.
 *
 * Five teams are already as rest-balanced as the arithmetic allows. Each block
 * has exactly one bye, so the team resting in the first block must then play
 * four straight, and the one resting in the last block must have played the
 * first four. The order below reaches that floor. Four teams play every block.
 */
export function robinBlocks(count: number): ReadonlyArray<ReadonlyArray<readonly [number, number]>> {
  if (count === 4) return [
    [[0,3],[1,2]], [[0,2],[3,1]], [[0,1],[2,3]],
  ];
  if (count === 5) return [
    [[1,4],[2,3]], [[0,4],[1,2]], [[0,3],[4,2]], [[0,2],[3,1]], [[0,1],[3,4]],
  ];
  if (count === 6) return SIX_TEAM_BLOCKS;
  throw new RangeError("Mini MLP supports 4, 5 or 6 teams");
}

/**
 * The final stage: the championship, and the bronze match beside it.
 *
 * Both are drawn together in one block — gold on courts 1–2, bronze on 3–4 —
 * so bronze uses the two courts that sat idle during the final and adds no time
 * to the night. Creation order carries which is which, the same convention the
 * fixed-partner medal round uses for courts. A final drawn before bronze
 * existed has only the gold match, and reads that way.
 */
export function finalsOf(ties: Encounter[]): { gold: Encounter | null; bronze: Encounter | null } {
  const finals = ties.filter(t => t.stage === "final").sort((a, b) => a.index - b.index);
  return { gold: finals[0] ?? null, bronze: finals[1] ?? null };
}

/** Semi-final winners and losers, in bracket order; null until both are decided. */
export function semiResults(ties: Encounter[]): { winners: [string, string]; losers: [string, string] } | null {
  const semis = ties.filter(t => t.stage === "semifinal").sort((a, b) => a.index - b.index);
  if (semis.length !== 2) return null;
  const decided = semis.map(s => {
    const winner = outcome(s).winner;
    return winner ? { winner, loser: winner === s.teamAId ? s.teamBId : s.teamAId } : null;
  });
  if (!decided[0] || !decided[1]) return null;
  return {
    winners: [decided[0].winner, decided[1].winner],
    losers: [decided[0].loser, decided[1].loser],
  };
}

/** Gold, silver and bronze — each only once the match deciding it is decided. */
export function podium(ties: Encounter[]): Array<{ place: 1 | 2 | 3; teamId: string }> {
  const { gold, bronze } = finalsOf(ties);
  const places: Array<{ place: 1 | 2 | 3; teamId: string }> = [];
  const goldWinner = gold ? outcome(gold).winner : null;
  if (gold && goldWinner) {
    places.push({ place: 1, teamId: goldWinner });
    places.push({ place: 2, teamId: goldWinner === gold.teamAId ? gold.teamBId : gold.teamAId });
  }
  const bronzeWinner = bronze ? outcome(bronze).winner : null;
  if (bronzeWinner) places.push({ place: 3, teamId: bronzeWinner });
  return places;
}

/** Every distinct pair must have a resolved round-robin encounter. */
export function roundRobinReady(teams: Team[], ties: Encounter[]): boolean {
  if (!validTeamCount(teams.length)) return false;
  const ids = new Set(teams.map(t => t.id));
  if (ids.size !== teams.length) return false;
  const robin = ties.filter(t => t.stage === "robin");
  if (robin.length !== encounterCount(teams.length)) return false;
  const pairs = new Set<string>();
  for (const tie of robin) {
    if (!ids.has(tie.teamAId) || !ids.has(tie.teamBId) || tie.teamAId === tie.teamBId || !outcome(tie).resolved) return false;
    pairs.add([tie.teamAId, tie.teamBId].sort().join("|"));
  }
  return pairs.size === robin.length;
}

export const hasExplicitOpeningPairs = (t: TeamInput) => OPENING_SLOTS.every(key => !!t[key]);

/** Legacy fallback preserves saved draws and any later playoff generation.
 * New setups must explicitly save all four categories before drawing games. */
export function teamLineups(t: TeamInput): Record<GameKind, [string, string]> {
  return {
    women: [t.women1 ?? t.w1, t.women2 ?? t.w2],
    men: [t.men1 ?? t.m1, t.men2 ?? t.m2],
    mixed1: [t.m1, t.w1],
    mixed2: [t.m2, t.w2],
  };
}

export function lineups(a: Team, b: Team, mixedCrossed = false) {
  const aa=teamLineups(a), bb=teamLineups(b);
  return GAME_KINDS.map(kind=>{
    const opponentKind=mixedCrossed && kind==="mixed1" ? "mixed2" : mixedCrossed && kind==="mixed2" ? "mixed1" : kind;
    return {kind,players:[...aa[kind],...bb[opponentKind]]};
  });
}

export function validateTeams(input: unknown, roster: ReadonlySet<string>, expectedCount: number): input is TeamInput[] {
  if (!validTeamCount(expectedCount) || !Array.isArray(input) || input.length !== expectedCount || roster.size !== expectedCount * 4) return false;
  const used = new Set<string>(), names = new Set<string>();
  for (const t of input) {
    if (!t || typeof t.name !== "string" || !t.name.trim() || t.name.trim().length > 40) return false;
    const name = t.name.trim().toLocaleLowerCase();
    if (names.has(name)) return false;
    names.add(name);
    for (const key of ["m1","m2","w1","w2"] as const) {
      const id = t[key];
      if (typeof id !== "string" || used.has(id) || !roster.has(id)) return false;
      used.add(id);
    }
    // Each wave must use the same four squad members exactly once. This keeps
    // workloads equal and prevents two simultaneous games for one player.
    const opening = OPENING_SLOTS.map(key=>t[key]);
    const squad = new Set(members(t));
    if (new Set(opening).size !== 4 || opening.some(id=>typeof id!=="string" || !squad.has(id))) return false;
  }
  return used.size === expectedCount * 4;
}

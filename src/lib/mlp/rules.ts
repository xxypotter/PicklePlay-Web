/** Mini MLP house rules. No database or UI dependencies. */
export const MLP_TEAMS = 6;
export const MLP_PLAYERS = 24;
export const MLP_COURTS = 4;
export const GAME_KINDS = ["women", "men", "mixed1", "mixed2"] as const;
export type GameKind = (typeof GAME_KINDS)[number];
export type Stage = "robin" | "semifinal" | "final";
export interface Team {
  id: string; slot: number; name: string;
  /** Setup fixes mixed pairs as m1+w1 and m2+w2 for the entire session. */
  m1: string; m2: string; w1: string; w2: string;
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
  let reason: "games" | "points" | "organizer" | "tied" | "pending" = "pending";
  if (complete) {
    if (winsA !== winsB) { winner = winsA > winsB ? tie.teamAId : tie.teamBId; reason = "games"; }
    else if (pointsA !== pointsB) { winner = pointsA > pointsB ? tie.teamAId : tie.teamBId; reason = "points"; }
    else if ([tie.teamAId, tie.teamBId].includes(tie.tiebreakWinner ?? "")) {
      winner = tie.tiebreakWinner; reason = "organizer";
    } else reason = "tied";
  }
  return { complete, winner, reason, winsA, winsB, pointsA, pointsB };
}

export function standings(teams: Team[], ties: Encounter[]) {
  const rows = new Map(teams.map(team => [team.id, {
    team, played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0,
  }]));
  for (const tie of ties.filter(t => t.stage === "robin")) {
    const a = rows.get(tie.teamAId), b = rows.get(tie.teamBId);
    if (!a || !b) continue;
    const result = outcome(tie);
    a.gamesWon += result.winsA; a.gamesLost += result.winsB;
    b.gamesWon += result.winsB; b.gamesLost += result.winsA;
    a.pointsFor += result.pointsA; a.pointsAgainst += result.pointsB;
    b.pointsFor += result.pointsB; b.pointsAgainst += result.pointsA;
    if (result.winner) {
      a.played++; b.played++;
      if (result.winner === a.team.id) { a.wins++; b.losses++; }
      else { b.wins++; a.losses++; }
    }
  }
  return [...rows.values()].sort((a,b) => b.wins-a.wins ||
    (b.gamesWon-b.gamesLost)-(a.gamesWon-a.gamesLost) ||
    (b.pointsFor-b.pointsAgainst)-(a.pointsFor-a.pointsAgainst) ||
    b.pointsFor-a.pointsFor || a.team.slot-b.team.slot);
}

/** Minimum eight two-court blocks for 15 encounters, every pairing exactly once.
 * Each entry uses courts 1–2, then 3–4. Two waves per block; no team double-books.
 * Explicit verified design avoids a heuristic missing or repeating an edge.
 */
export const ROBIN_BLOCKS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0,5],[1,4]], [[2,3],[0,4]], [[5,3],[1,2]], [[0,3],[4,2]],
  [[5,1],[0,2]], [[3,1],[4,5]], [[0,1],[2,5]], [[3,4]],
];

export function lineups(a: Team, b: Team) {
  return [
    { kind: "women" as const, players: [a.w1,a.w2,b.w1,b.w2] },
    { kind: "men" as const, players: [a.m1,a.m2,b.m1,b.m2] },
    { kind: "mixed1" as const, players: [a.m1,a.w1,b.m1,b.w1] },
    { kind: "mixed2" as const, players: [a.m2,a.w2,b.m2,b.w2] },
  ];
}

export function validateTeams(input: unknown, roster: ReadonlyMap<string, string>): input is TeamInput[] {
  if (!Array.isArray(input) || input.length !== 6) return false;
  const used = new Set<string>(), names = new Set<string>();
  for (const t of input) {
    if (!t || typeof t.name !== "string" || !t.name.trim() || t.name.trim().length > 40) return false;
    const name = t.name.trim().toLocaleLowerCase();
    if (names.has(name)) return false;
    names.add(name);
    for (const [key, gender] of [["m1","male"],["m2","male"],["w1","female"],["w2","female"]] as const) {
      const id = t[key];
      if (typeof id !== "string" || used.has(id) || roster.get(id) !== gender) return false;
      used.add(id);
    }
  }
  return used.size === 24;
}

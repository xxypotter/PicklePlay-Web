import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { matches, mlpTeams, mlpTies, players } from "@/lib/db/schema";
import { hasExplicitOpeningPairs, type Encounter, type Team } from "./rules";

export interface MlpData {
  teams: Team[];
  ties: Encounter[];
  names: Record<string, string>;
  canCorrectOpeningPairs: boolean;
}

export async function getMlpData(sessionId: string): Promise<MlpData> {
  const db = getDb();
  const [teams, ties, games] = await Promise.all([
    db.select().from(mlpTeams).where(eq(mlpTeams.sessionId, sessionId)).orderBy(asc(mlpTeams.slot)),
    db.select().from(mlpTies).where(eq(mlpTies.sessionId, sessionId)).orderBy(asc(mlpTies.index)),
    db.select().from(matches).where(eq(matches.sessionId, sessionId)),
  ]);
  const ids = teams.flatMap(t => [t.m1,t.m2,t.w1,t.w2]);
  const people = ids.length ? await db.select({ id: players.id, username: players.username })
    .from(players).where(inArray(players.id, ids)) : [];
  return {
    teams, names: Object.fromEntries(people.map(p => [p.id,p.username])),
    canCorrectOpeningPairs: teams.length>0 && teams.every(t=>!hasExplicitOpeningPairs(t)) && games.length>0 &&
      games.every(g=>g.status==="scheduled" && g.scoreA===null && g.scoreB===null && g.enteredBy===null && g.editedAt===null) &&
      ties.every(t=>t.stage==="robin" && t.tiebreakWinner===null),
    ties: ties.map(t => ({ ...t, games: games.filter(g => g.mlpTieId === t.id).map(g => ({
      kind: g.mlpGame, scoreA: g.scoreA, scoreB: g.scoreB, status: g.status,
    })) })),
  };
}

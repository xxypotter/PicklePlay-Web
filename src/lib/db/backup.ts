import { asc, getTableColumns, sql } from "drizzle-orm";
import { inTransaction } from "./transaction";
import { matches, mlpTeams, mlpTies, players, ratingSeeds, rounds, sessions, signups } from "./schema";

/** Consistent recovery snapshot; excludes authentication and invite secrets. */
export async function makeBackup() {
  return inTransaction(async db=>{
    await db.execute(sql`set transaction isolation level repeatable read, read only`);
    const columns=getTableColumns(players);
    const {pinHash: excluded, ...safePlayers}=columns;
    void excluded;
    const data={
      players:await db.select(safePlayers).from(players).orderBy(asc(players.createdAt)),
      ratingSeeds:await db.select().from(ratingSeeds).orderBy(asc(ratingSeeds.effectiveAt)),
      sessions:await db.select().from(sessions).orderBy(asc(sessions.startsAt)),
      signups:await db.select().from(signups).orderBy(asc(signups.createdAt)),
      rounds:await db.select().from(rounds).orderBy(asc(rounds.sessionId),asc(rounds.index)),
      mlpTeams:await db.select().from(mlpTeams).orderBy(asc(mlpTeams.slot)),
      mlpTies:await db.select().from(mlpTies).orderBy(asc(mlpTies.index)),
      matches:await db.select().from(matches).orderBy(asc(matches.playedAt)),
    };
    return {schema:2,takenAt:new Date().toISOString(),
      note:"Restore sources in dependency order, reset PINs and invite code, then recompute rating caches. Auth tokens, PIN hashes, settings, login attempts and audit details are intentionally excluded.",
      counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),...data};
  });
}

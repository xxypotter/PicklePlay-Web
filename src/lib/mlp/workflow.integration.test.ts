/** Explicit opt-in. Never runs against production. Uses real DB/actions, mocked request identity only. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, matches, mlpTeams, mlpTies, players, playerStats, ratingEvents, ratingSeeds, rounds, sessions, signups } from "@/lib/db/schema";
import { makeT } from "@/lib/i18n/translate";
import type { Actor } from "@/lib/auth/policy";
import { inTransaction } from "@/lib/db/transaction";
import { recomputeAll } from "@/lib/rating/service";
import { makeBackup } from "@/lib/db/backup";
import { addMlpPlayoffAction, createMlpScheduleAction, removeMlpPlayoffsAction, saveMlpTeamsAction, setMlpTiebreakAction } from "./actions";
import { createManualRoundAction, discardRoundAction, generateAllRoundsAction, rebuildMatchupsAction, restoreMatchAction, saveScoreAction, voidMatchAction } from "@/lib/sessions/play-actions";
import { addPlayerAction, removePlayerAction, setAttendanceAction, setPartnerAction } from "@/lib/sessions/actions";
import { lineups, type TeamInput } from "./rules";
import { deletePlayerAction } from "@/app/admin/actions";

let actor:Actor;
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/auth/permissions",()=>({requireLogin:async()=>actor,requireAdmin:async()=>actor,requireSuperAdmin:async()=>actor}));
vi.mock("@/lib/i18n/server",()=>({getT:async()=>makeT("en")}));

describe.skipIf(process.env.RUN_DEV_INTEGRATION!=="1")("v1.7 development workflow",()=>{
  const personIds:string[]=Array.from({length:25},()=>randomUUID());
  const id=randomUUID(), otherId=randomUUID(), fixedId=randomUUID();
  let verified=false;
  const input:TeamInput[]=Array.from({length:6},(_,i)=>({name:`Test team ${i+1}`,m1:personIds[i*4],w1:personIds[i*4+1],m2:personIds[i*4+2],w2:personIds[i*4+3]}));
  beforeAll(async()=>{
    config({path:".env.local",quiet:true});
    if(new URL(process.env.DATABASE_URL!).pathname!=="/pickleplay_dev") throw new Error("Development DB required");
    const probe=await getDb().execute<{name:string}>(sql`select current_database() as name`);
    if(probe.rows[0]?.name!=="pickleplay_dev") throw new Error("Development DB required");
    verified=true;
    actor={id:personIds[0],role:"admin"};
    await getDb().insert(players).values(personIds.map((pid,i)=>({id:pid,username:`v17test_${pid}`,usernameLower:`v17test_${pid}`,pinHash:"disabled-test-only",role:i===0?"admin" as const:"player" as const,gender:i%2===0?"male" as const:"female" as const})));
    await getDb().insert(sessions).values([{id,title:"Mini MLP integration",createdBy:actor.id,format:"mlp",courtCount:4,courtNames:["1","2","3","4"],maxPlayers:24,status:"live",rated:false,startsAt:new Date()},
      {id:otherId,title:"Other integration",createdBy:personIds[24],status:"live",rated:false,startsAt:new Date()},
      {id:fixedId,title:"Fixed integration",createdBy:actor.id,format:"fixed",courtCount:4,courtNames:["1","2","3","4"],maxPlayers:16,status:"live",rated:false,startsAt:new Date()}]);
    await getDb().insert(signups).values(personIds.slice(0,24).map(playerId=>({sessionId:id,playerId,state:"in" as const})));
    await getDb().insert(signups).values(personIds.slice(0,16).map(playerId=>({sessionId:fixedId,playerId,state:"in" as const})));
  },30000);
  afterAll(async()=>{
    if(!verified)return;
    await getDb().delete(sessions).where(inArray(sessions.id,[id,otherId,fixedId]));
    await getDb().delete(auditLog).where(inArray(auditLog.actorId,personIds));
    await getDb().delete(players).where(inArray(players.id,personIds));
  },30000);
  const score=async(matchId:string,a:number,b:number)=>{
    const fd=new FormData();fd.set("matchId",matchId);fd.set("scoreA",String(a));fd.set("scoreB",String(b));return saveScoreAction({},fd);
  };
  it("runs setup through a 72-game tournament; rejects partner changes, premature playoffs and stale bracket edits",async()=>{
    await expect(saveMlpTeamsAction(id,input.map((t,i)=>i? t:{...t,m1:t.w1}))).rejects.toThrow();
    await saveMlpTeamsAction(id,input);
    const deletion = new FormData(); deletion.set("playerId",personIds[1]);
    expect((await deletePlayerAction({},deletion)).error).toBe(makeT("en")("err.deleteMlpTeam"));
    await createMlpScheduleAction(id);
    await expect(createMlpScheduleAction(id)).rejects.toThrow();
    const db=getDb();
    const teams=await db.select().from(mlpTeams).where(eq(mlpTeams.sessionId,id));
    const ties=await db.select().from(mlpTies).where(eq(mlpTies.sessionId,id));
    let games=await db.select().from(matches).where(eq(matches.sessionId,id));
    expect(ties).toHaveLength(15);expect(games).toHaveLength(60);
    for(const tie of ties){
      const expected=lineups(teams.find(t=>t.id===tie.teamAId)!,teams.find(t=>t.id===tie.teamBId)!);
      for(const g of expected){const actual=games.find(m=>m.mlpTieId===tie.id&&m.mlpGame===g.kind)!;expect([actual.a1,actual.a2,actual.b1,actual.b2]).toEqual(g.players);}
    }
    await expect(saveMlpTeamsAction(id,input)).rejects.toThrow();
    await expect(setPartnerAction(id,personIds[0],personIds[1])).rejects.toThrow();
    await expect(addPlayerAction(id,personIds[24])).rejects.toThrow();
    await expect(removePlayerAction(id,personIds[0])).rejects.toThrow();
    await expect(setAttendanceAction(id,personIds[0],false)).rejects.toThrow();
    await expect(createManualRoundAction(id,[[...personIds.slice(0,4)] as [string,string,string,string]])).rejects.toThrow();
    await expect(rebuildMatchupsAction(id,1)).rejects.toThrow();
    await expect(addMlpPlayoffAction(id)).rejects.toThrow();
    // One exact team tie; all remaining encounters won by A.
    const exact=ties[0];
    for(const m of games) {
      const lose=m.mlpTieId===exact.id && ["mixed1","mixed2"].includes(m.mlpGame!);
      expect(await score(m.id,lose?8:11,lose?11:8)).toEqual({});
    }
    await expect(addMlpPlayoffAction(id)).rejects.toThrow();
    await expect(setMlpTiebreakAction(id,exact.id,teams.find(t=>![exact.teamAId,exact.teamBId].includes(t.id))!.id)).rejects.toThrow();
    await setMlpTiebreakAction(id,exact.id,exact.teamAId);
    await addMlpPlayoffAction(id);
    expect((await score(games[0].id,12,8)).error).toBeTruthy();
    await removeMlpPlayoffsAction(id);
    await addMlpPlayoffAction(id);
    let playoffs=await db.select().from(mlpTies).where(and(eq(mlpTies.sessionId,id),eq(mlpTies.stage,"semifinal")));
    expect(playoffs).toHaveLength(2);
    for(const m of await db.select().from(matches).where(inArray(matches.mlpTieId,playoffs.map(t=>t.id))))expect(await score(m.id,11,8)).toEqual({});
    await expect(removeMlpPlayoffsAction(id)).rejects.toThrow();
    await addMlpPlayoffAction(id);
    playoffs=await db.select().from(mlpTies).where(and(eq(mlpTies.sessionId,id),eq(mlpTies.stage,"final")));
    expect(playoffs).toHaveLength(1);
    for(const m of await db.select().from(matches).where(eq(matches.mlpTieId,playoffs[0].id)))expect(await score(m.id,11,8)).toEqual({});
    games=await db.select().from(matches).where(eq(matches.sessionId,id));
    expect(games).toHaveLength(72);expect(games.every(g=>g.status==="completed")).toBe(true);
  },300000);
  it("keeps fixed pairs after a partial-session rebuild; denies cross-session discard and score-based void restoration",async()=>{
    const db=getDb();
    for(let i=0;i<16;i+=2)await setPartnerAction(fixedId,personIds[i],personIds[i+1]);
    await generateAllRoundsAction(fixedId,7);
    let gs=await db.select().from(matches).where(eq(matches.sessionId,fixedId));
    expect(gs).toHaveLength(28);
    const edges=gs.map(g=>[g.a1,g.a2].sort().join("|")+"/"+[g.b1,g.b2].sort().join("|"));
    expect(new Set(edges.map(e=>e.split("/").sort().join("/"))).size).toBe(28);
    expect(await score(gs[0].id,11,8)).toEqual({});
    await rebuildMatchupsAction(fixedId,2);
    gs=await db.select().from(matches).where(eq(matches.sessionId,fixedId));
    const partner=new Map(personIds.slice(0,16).map((pid,i)=>[pid,personIds[i^1]]));
    for(const g of gs){expect(partner.get(g.a1)).toBe(g.a2);expect(partner.get(g.b1)).toBe(g.b2);}
    const [foreign]=await db.insert(rounds).values({sessionId:otherId,index:1}).returning();
    await expect(discardRoundAction(fixedId,foreign.id)).rejects.toThrow();
    expect(await db.select().from(rounds).where(eq(rounds.id,foreign.id))).toHaveLength(1);
    const scored=gs.find(g=>g.status==="completed")!;
    await expect(voidMatchAction(scored.id)).rejects.toThrow();
    actor={...actor,role:"superadmin"};await voidMatchAction(scored.id);
    actor={...actor,role:"admin"};expect((await score(scored.id,11,9)).error).toBeTruthy();
    await expect(restoreMatchAction(scored.id)).rejects.toThrow();
    actor={...actor,role:"superadmin"};await restoreMatchAction(scored.id);actor={...actor,role:"admin"};
  },120000);
  it("backs up complete session structure and publishes concurrent rating replays atomically",async()=>{
    const db=getDb(),backup=await makeBackup();
    expect(backup.schema).toBe(2);expect(backup.mlpTies.filter(t=>t.sessionId===id)).toHaveLength(18);
    expect(backup.rounds.filter(r=>r.sessionId===id)).toHaveLength(20);
    expect(backup.players[0]).not.toHaveProperty("pinHash");expect(backup.players[0]).toHaveProperty("gender");
    const first=new Date("2026-09-25T00:00:00Z");
    await db.insert(ratingSeeds).values(personIds.slice(0,24).map(playerId=>({playerId,rating:3,source:"picker" as const,effectiveAt:first})));
    await db.update(sessions).set({rated:true}).where(eq(sessions.id,id));
    await Promise.all([recomputeAll(),recomputeAll()]);
    const ids=(await db.select({id:matches.id}).from(matches).where(eq(matches.sessionId,id))).map(m=>m.id);
    expect(await db.select().from(ratingEvents).where(inArray(ratingEvents.matchId,ids))).toHaveLength(72*4);
    const before=await db.select().from(playerStats).where(inArray(playerStats.playerId,personIds));
    await expect(inTransaction(async tx=>{await tx.delete(playerStats).where(inArray(playerStats.playerId,personIds));throw new Error("simulated rollback");})).rejects.toThrow("simulated rollback");
    expect(await db.select().from(playerStats).where(inArray(playerStats.playerId,personIds))).toEqual(before);
  },60000);
});

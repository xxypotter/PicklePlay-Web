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
import { addMlpPlayoffAction, correctMlpOpeningPairsAction, createMlpScheduleAction, removeMlpPlayoffsAction, saveMlpTeamsAction, setMlpTiebreakAction } from "./actions";
import { createManualRoundAction, discardRoundAction, generateAllRoundsAction, rebuildMatchupsAction, restoreMatchAction, saveScoreAction, voidMatchAction } from "@/lib/sessions/play-actions";
import { addPlayerAction, removePlayerAction, setAttendanceAction, setPartnerAction } from "@/lib/sessions/actions";
import { finalsOf, lineups, outcome, podium, standings, type Encounter, type TeamInput } from "./rules";
import { deletePlayerAction } from "@/app/admin/actions";

let actor:Actor;
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/auth/permissions",()=>({requireLogin:async()=>actor,requireAdmin:async()=>actor,requireSuperAdmin:async()=>actor}));
vi.mock("@/lib/i18n/server",()=>({getT:async()=>makeT("en")}));

describe.skipIf(process.env.RUN_DEV_INTEGRATION!=="1")("v1.7 development workflow",()=>{
  const personIds:string[]=Array.from({length:25},()=>randomUUID());
  const id=randomUUID(), otherId=randomUUID(), fixedId=randomUUID();
  const flexibleIds=[randomUUID(),randomUUID()];
  const courtCases=[4,5,6].flatMap(count=>[4,5,6].map(courts=>({count,courts,id:randomUUID()})));
  const legacyId=randomUUID();
  let verified=false;
  // Exercise every composition in actual stored player profiles, including unknown gender.
  const genders:("male"|"female"|"unspecified")[]=[
    "male","male","male","male", "female","female","female","female",
    "male","male","male","female", "male","female","female","female",
    "male","female","male","female", "unspecified","unspecified","unspecified","unspecified", "male",
  ];
  const input:TeamInput[]=Array.from({length:6},(_,i)=>({name:`Test team ${i+1}`,m1:personIds[i*4],w1:personIds[i*4+1],m2:personIds[i*4+2],w2:personIds[i*4+3],
    women1:personIds[i*4],women2:personIds[i*4+3],men1:personIds[i*4+1],men2:personIds[i*4+2]}));
  // Independently check persisted participants against organizer inputs, not
  // against the generator being tested. Includes every RR/playoff game.
  const assertSavedLineups=async(sessionId:string)=>{
    const db=getDb();
    const teams=await db.select().from(mlpTeams).where(eq(mlpTeams.sessionId,sessionId));
    const ties=await db.select().from(mlpTies).where(eq(mlpTies.sessionId,sessionId));
    const games=await db.select().from(matches).where(eq(matches.sessionId,sessionId));
    const pair=(teamId:string,kind:string)=>{
      const chosen=input.find(t=>t.name===teams.find(t=>t.id===teamId)!.name)!;
      return kind==="women"?[chosen.women1,chosen.women2]:kind==="men"?[chosen.men1,chosen.men2]:
        kind==="mixed1"?[chosen.m1,chosen.w1]:[chosen.m2,chosen.w2];
    };
    for(const g of games){
      const tie=ties.find(t=>t.id===g.mlpTieId)!;
      expect([g.a1,g.a2]).toEqual(pair(tie.teamAId,g.mlpGame!));
      expect([g.b1,g.b2]).toEqual(pair(tie.teamBId,g.mlpGame!));
    }
  };
  beforeAll(async()=>{
    config({path:".env.local",quiet:true});
    if(new URL(process.env.DATABASE_URL!).pathname!=="/pickleplay_dev") throw new Error("Development DB required");
    const probe=await getDb().execute<{name:string}>(sql`select current_database() as name`);
    if(probe.rows[0]?.name!=="pickleplay_dev") throw new Error("Development DB required");
    verified=true;
    actor={id:personIds[0],role:"admin"};
    await getDb().insert(players).values(personIds.map((pid,i)=>({id:pid,username:`v17test_${pid}`,usernameLower:`v17test_${pid}`,pinHash:"disabled-test-only",role:i===0?"admin" as const:"player" as const,gender:genders[i]})));
    await getDb().insert(sessions).values([{id,title:"Mini MLP integration",createdBy:actor.id,format:"mlp",courtCount:5,courtNames:["1","2","3","4","5"],maxPlayers:24,status:"live",rated:false,startsAt:new Date()},
      {id:otherId,title:"Other integration",createdBy:personIds[24],status:"live",rated:false,startsAt:new Date()},
      {id:fixedId,title:"Fixed integration",createdBy:actor.id,format:"fixed",courtCount:4,courtNames:["1","2","3","4"],maxPlayers:16,status:"live",rated:false,startsAt:new Date()}]);
    await getDb().insert(signups).values(personIds.slice(0,23).map(playerId=>({sessionId:id,playerId,state:"in" as const})));
    await getDb().insert(signups).values(personIds.slice(0,16).map(playerId=>({sessionId:fixedId,playerId,state:"in" as const})));
  },30000);
  afterAll(async()=>{
    if(!verified)return;
    await getDb().delete(sessions).where(inArray(sessions.id,[id,otherId,fixedId,legacyId,...flexibleIds,...courtCases.map(c=>c.id)]));
    await getDb().delete(auditLog).where(inArray(auditLog.actorId,personIds));
    await getDb().delete(players).where(inArray(players.id,personIds));
  },30000);
  const score=async(matchId:string,a:number,b:number)=>{
    const fd=new FormData();fd.set("matchId",matchId);fd.set("scoreA",String(a));fd.set("scoreB",String(b));return saveScoreAction({},fd);
  };
  it("runs setup through a 76-game tournament with a bronze match; rejects partner changes, premature playoffs and stale bracket edits",async()=>{
    // Tomorrow's shape: 23/24 present, five courts. No partial tournament.
    await expect(saveMlpTeamsAction(id,input)).rejects.toThrow();
    await addPlayerAction(id,personIds[23]);
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
    expect(new Set(games.map(g=>g.roundId)).size).toBe(12);
    expect(new Set(games.map(g=>g.courtNo))).toEqual(new Set([1,2,3,4,5]));
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
    // Exact RR ties resolve automatically; all teams have five counted encounters.
    const readExact=async()=> (await db.select().from(mlpTies).where(eq(mlpTies.id,exact.id)))[0];
    const completed=await db.select().from(matches).where(eq(matches.sessionId,id));
    const encounters=ties.map(t=>({...t,games:completed.filter(g=>g.mlpTieId===t.id).map(g=>({...g,kind:g.mlpGame}))}));
    expect(outcome(encounters.find(t=>t.id===exact.id)!)).toMatchObject({draw:true,resolved:true});
    expect(standings(teams,encounters).every(r=>r.played===5&&r.wins+r.losses+r.draws===5)).toBe(true);
    await addMlpPlayoffAction(id);
    await expect(setMlpTiebreakAction(id,exact.id,exact.teamAId)).rejects.toThrow();
    await setMlpTiebreakAction(id,exact.id,"draw","No DreamBreaker played");
    await removeMlpPlayoffsAction(id);
    const organizer=actor;
    for(const role of ["player","admin"] as const) {
      actor={id:personIds[24],role};
      await expect(setMlpTiebreakAction(id,exact.id,exact.teamAId)).rejects.toThrow();
    }
    actor=organizer;
    await expect(setMlpTiebreakAction(otherId,exact.id,exact.teamAId)).rejects.toThrow();
    await expect(setMlpTiebreakAction(id,exact.id,"draw","x".repeat(501))).rejects.toThrow();
    await expect(setMlpTiebreakAction(id,ties[1].id,"draw")).rejects.toThrow();
    await expect(setMlpTiebreakAction(id,exact.id,teams.find(t=>![exact.teamAId,exact.teamBId].includes(t.id))!.id)).rejects.toThrow();
    await setMlpTiebreakAction(id,exact.id,exact.teamAId,"  Team A won the DreamBreaker  ");
    expect(await readExact()).toMatchObject({tiebreakWinner:exact.teamAId,decisionNote:"Team A won the DreamBreaker"});
    await setMlpTiebreakAction(id,exact.id,"draw","No DreamBreaker played");
    expect(await readExact()).toMatchObject({tiebreakWinner:null,decisionNote:"No DreamBreaker played"});
    const first=completed.find(g=>g.mlpTieId===exact.id)!;
    expect(await score(first.id,0,0)).toEqual({});
    expect(await readExact()).toMatchObject({tiebreakWinner:null,decisionNote:null});
    await expect(setMlpTiebreakAction(id,exact.id,"draw")).rejects.toThrow();
    expect(await score(first.id,first.scoreA!,first.scoreB!)).toEqual({});
    actor={...organizer,role:"superadmin"};
    await setMlpTiebreakAction(id,exact.id,exact.teamAId,"DreamBreaker win");
    await voidMatchAction(first.id);
    expect(await readExact()).toMatchObject({tiebreakWinner:null,decisionNote:null});
    await expect(setMlpTiebreakAction(id,exact.id,"draw")).rejects.toThrow();
    await restoreMatchAction(first.id);
    actor=organizer;
    await setMlpTiebreakAction(id,exact.id,exact.teamAId,"DreamBreaker win");
    await addMlpPlayoffAction(id);
    await expect(setMlpTiebreakAction(id,exact.id,"draw")).rejects.toThrow();
    await setMlpTiebreakAction(id,exact.id,exact.teamAId,"DreamBreaker won 21–19");
    expect((await readExact()).decisionNote).toBe("DreamBreaker won 21–19");
    expect((await score(games[0].id,12,8)).error).toBeTruthy();
    await removeMlpPlayoffsAction(id);
    await addMlpPlayoffAction(id);
    let playoffs=await db.select().from(mlpTies).where(and(eq(mlpTies.sessionId,id),eq(mlpTies.stage,"semifinal")));
    expect(playoffs).toHaveLength(2);
    for(const m of await db.select().from(matches).where(inArray(matches.mlpTieId,playoffs.map(t=>t.id)))) {
      const lose=m.mlpTieId===playoffs[0].id&&["mixed1","mixed2"].includes(m.mlpGame!);
      expect(await score(m.id,lose?8:11,lose?11:8)).toEqual({});
    }
    await expect(setMlpTiebreakAction(id,playoffs[0].id,"draw")).rejects.toThrow();
    await expect(addMlpPlayoffAction(id)).rejects.toThrow();
    await setMlpTiebreakAction(id,playoffs[0].id,playoffs[0].teamAId,"Semifinal DreamBreaker win");
    await expect(removeMlpPlayoffsAction(id)).rejects.toThrow();
    await addMlpPlayoffAction(id);
    // Undoing an unplayed final takes the bronze match with it, then redraws both.
    await removeMlpPlayoffsAction(id);
    expect(await db.select().from(mlpTies).where(and(eq(mlpTies.sessionId,id),eq(mlpTies.stage,"final")))).toHaveLength(0);
    expect(await db.select().from(rounds).where(and(eq(rounds.sessionId,id),eq(rounds.stage,"final")))).toHaveLength(0);
    await addMlpPlayoffAction(id);
    playoffs=await db.select().from(mlpTies).where(and(eq(mlpTies.sessionId,id),eq(mlpTies.stage,"final")));
    expect(playoffs).toHaveLength(2);
    // Gold and bronze share one block, so the playoffs add no extra waves.
    expect(new Set(playoffs.map(t=>t.block)).size).toBe(1);
    const finalGames=await db.select().from(matches).where(inArray(matches.mlpTieId,playoffs.map(t=>t.id)));
    expect(new Set(finalGames.map(g=>g.roundId)).size).toBe(2);
    for(const m of finalGames)expect(await score(m.id,11,8)).toEqual({});
    await expect(addMlpPlayoffAction(id)).rejects.toThrow();
    games=await db.select().from(matches).where(eq(matches.sessionId,id));
    expect(games).toHaveLength(76);expect(games.every(g=>g.status==="completed")).toBe(true);
    await assertSavedLineups(id);
    await expect(correctMlpOpeningPairsAction(id,input)).rejects.toThrow();
    // Closure does not remove the organizer's ability to annotate results.
    await db.update(sessions).set({status:"closed"}).where(eq(sessions.id,id));
    await setMlpTiebreakAction(id,exact.id,exact.teamAId,"Closed-session DreamBreaker note");
    expect((await readExact()).decisionNote).toBe("Closed-session DreamBreaker note");
    actor={id:personIds[24],role:"admin"};
    await expect(setMlpTiebreakAction(id,exact.id,exact.teamAId,"Unauthorized")).rejects.toThrow();
    actor=organizer;
    await expect(setMlpTiebreakAction(id,exact.id,"draw")).rejects.toThrow();
  },300000);
  it.each(courtCases)("persists $count teams / $courts courts without court or player collisions",async({count,courts,id:sessionId})=>{
    const db=getDb();
    await db.insert(sessions).values({id:sessionId,title:"Court matrix",createdBy:actor.id,format:"mlp",
      courtCount:courts,courtNames:Array.from({length:courts},(_,i)=>String(i+1)),maxPlayers:count*4,status:"live",rated:false,startsAt:new Date()});
    await db.insert(signups).values(personIds.slice(0,count*4).map(playerId=>({sessionId,playerId,state:"in" as const})));
    await saveMlpTeamsAction(sessionId,input.slice(0,count));
    await createMlpScheduleAction(sessionId);
    const games=await db.select().from(matches).where(eq(matches.sessionId,sessionId));
    const ties=await db.select().from(mlpTies).where(eq(mlpTies.sessionId,sessionId));
    const rs=await db.select().from(rounds).where(eq(rounds.sessionId,sessionId)).orderBy(rounds.index);
    expect(games).toHaveLength(count*(count-1)*2);
    expect(new Set(ties.map(t=>[t.teamAId,t.teamBId].sort().join("|"))).size).toBe(count*(count-1)/2);
    expect(rs).toHaveLength(count===4?6:count===5?10:courts===4?16:courts===5?12:10);
    for(const r of rs) {
      const gs=games.filter(g=>g.roundId===r.id);
      expect(new Set(gs.map(g=>g.courtNo)).size).toBe(gs.length);
      expect(new Set(gs.flatMap(g=>[g.a1,g.a2,g.b1,g.b2])).size).toBe(gs.length*4);
      expect(gs.every(g=>g.courtNo!==null&&g.courtNo>=1&&g.courtNo<=courts)).toBe(true);
    }
    for(let i=1;i<rs.length;i++) expect(Math.min(...games.filter(g=>g.roundId===rs[i].id).map(g=>g.playedAt.getTime())))
      .toBeGreaterThan(Math.max(...games.filter(g=>g.roundId===rs[i-1].id).map(g=>g.playedAt.getTime())));
    await assertSavedLineups(sessionId);
    // Simulated results stay exclusively in the guarded development database.
    await db.update(matches).set({status:"completed",scoreA:11,scoreB:8}).where(eq(matches.sessionId,sessionId));
    await addMlpPlayoffAction(sessionId);
    await db.update(matches).set({status:"completed",scoreA:11,scoreB:8}).where(eq(matches.sessionId,sessionId));
    await addMlpPlayoffAction(sessionId);
    expect(await db.select().from(matches).where(eq(matches.sessionId,sessionId))).toHaveLength(count*(count-1)*2+16);
    await assertSavedLineups(sessionId);
  },90000);
  it.each([4,5])("runs a %i-team tournament with all-men, all-women and asymmetric teams, enforcing capacity and playoff seeding",async count=>{
    const db=getDb(),sessionId=flexibleIds[count-4],roster=personIds.slice(0,count*4);
    const selected=input.slice(0,count);
    await db.insert(sessions).values({id:sessionId,title:`Flexible MLP ${count}`,createdBy:actor.id,
      format:"mlp",courtCount:4,courtNames:["1","2","3","4"],maxPlayers:count*4,status:"live",rated:false,startsAt:new Date()});
    await db.insert(signups).values(roster.map(playerId=>({sessionId,playerId,state:"in" as const})));
    await expect(addPlayerAction(sessionId,personIds[count*4])).rejects.toThrow();
    await expect(saveMlpTeamsAction(sessionId,input)).rejects.toThrow();
    await saveMlpTeamsAction(sessionId,selected);
    await setAttendanceAction(sessionId,roster[0],false);
    await expect(createMlpScheduleAction(sessionId)).rejects.toThrow();
    await setAttendanceAction(sessionId,roster[0],true);
    await createMlpScheduleAction(sessionId);
    await expect(saveMlpTeamsAction(sessionId,selected)).rejects.toThrow();
    await expect(addMlpPlayoffAction(sessionId)).rejects.toThrow();
    const teams=await db.select().from(mlpTeams).where(eq(mlpTeams.sessionId,sessionId));
    const robin=await db.select().from(mlpTies).where(eq(mlpTies.sessionId,sessionId));
    const games=await db.select().from(matches).where(eq(matches.sessionId,sessionId));
    expect(robin).toHaveLength(count*(count-1)/2);
    expect(games).toHaveLength(count*(count-1)*2);
    expect(await db.select().from(rounds).where(eq(rounds.sessionId,sessionId))).toHaveLength(count===4?6:10);
    for(const tie of robin) {
      const expected=lineups(teams.find(t=>t.id===tie.teamAId)!,teams.find(t=>t.id===tie.teamBId)!);
      for(const g of expected) {
        const actual=games.find(m=>m.mlpTieId===tie.id&&m.mlpGame===g.kind)!;
        expect([actual.a1,actual.a2,actual.b1,actual.b2]).toEqual(g.players);
        expect(await score(actual.id,11,8)).toEqual({});
      }
    }
    const completed:Encounter[]=robin.map(t=>({...t,games:games.filter(g=>g.mlpTieId===t.id)
      .map(g=>({kind:g.mlpGame,scoreA:11,scoreB:8,status:"completed"}))}));
    const seeds=standings(teams,completed).map(r=>r.team.id);
    await addMlpPlayoffAction(sessionId);
    const semis=await db.select().from(mlpTies).where(and(eq(mlpTies.sessionId,sessionId),eq(mlpTies.stage,"semifinal")));
    expect(new Set(semis.map(t=>[t.teamAId,t.teamBId].join("/")))).toEqual(new Set([
      [seeds[0],seeds[3]].join("/"),[seeds[1],seeds[2]].join("/"),
    ]));
    for(const m of await db.select().from(matches).where(inArray(matches.mlpTieId,semis.map(t=>t.id)))) expect(await score(m.id,11,8)).toEqual({});
    await addMlpPlayoffAction(sessionId);
    // Every team-A seed won its semifinal, so 1 and 2 play for gold, 4 and 3 for bronze.
    const finals=await db.select().from(mlpTies).where(and(eq(mlpTies.sessionId,sessionId),eq(mlpTies.stage,"final")));
    const {gold,bronze}=finalsOf(finals.map(t=>({...t,games:[]})));
    expect([gold!.teamAId,gold!.teamBId]).toEqual([seeds[0],seeds[1]]);
    expect([bronze!.teamAId,bronze!.teamBId]).toEqual([seeds[3],seeds[2]]);
    const finalGames=await db.select().from(matches).where(inArray(matches.mlpTieId,finals.map(t=>t.id)));
    const court=(tieId:string)=>finalGames.filter(g=>g.mlpTieId===tieId).map(g=>g.courtNo).sort();
    expect(court(gold!.id)).toEqual([1,1,2,2]);expect(court(bronze!.id)).toEqual([3,3,4,4]);
    for(const m of finalGames) expect(await score(m.id,11,8)).toEqual({});
    const scored=(tie:typeof gold)=>({...tie!,games:finalGames.filter(g=>g.mlpTieId===tie!.id).map(g=>({kind:g.mlpGame,scoreA:11,scoreB:8,status:"completed" as const}))});
    expect(podium([scored(gold),scored(bronze)])).toEqual([{place:1,teamId:seeds[0]},{place:2,teamId:seeds[1]},{place:3,teamId:seeds[3]}]);
    expect(outcome(scored(gold)).winner).toBe(gold!.teamAId);
    expect(await db.select().from(matches).where(eq(matches.sessionId,sessionId))).toHaveLength(count*(count-1)*2+16);
    await expect(addMlpPlayoffAction(sessionId)).rejects.toThrow();
    await assertSavedLineups(sessionId);
  },180000);
  it("corrects only an untouched legacy draw once, preserving mixed partners and all match identities",async()=>{
    const db=getDb(), selected=input.slice(0,4);
    const legacy=selected.map(t=>({...t,women1:t.w1,women2:t.w2,men1:t.m1,men2:t.m2}));
    await db.insert(sessions).values({id:legacyId,title:"Legacy correction test",createdBy:actor.id,
      format:"mlp",courtCount:4,courtNames:["1","2","3","4"],maxPlayers:16,status:"live",rated:false,startsAt:new Date()});
    await db.insert(signups).values(personIds.slice(0,16).map(playerId=>({sessionId:legacyId,playerId,state:"in" as const})));
    await saveMlpTeamsAction(legacyId,legacy);
    await createMlpScheduleAction(legacyId);
    await expect(correctMlpOpeningPairsAction(legacyId,selected)).rejects.toThrow();
    // Simulate the pre-migration nullable row shape on a synthetic dev fixture.
    await db.update(mlpTeams).set({women1:null,women2:null,men1:null,men2:null}).where(eq(mlpTeams.sessionId,legacyId));
    await db.update(sessions).set({status:"closed"}).where(eq(sessions.id,legacyId));
    const before=await db.select().from(matches).where(eq(matches.sessionId,legacyId));
    actor={...actor,id:personIds[24]};
    await expect(correctMlpOpeningPairsAction(legacyId,selected)).rejects.toThrow();
    actor={...actor,id:personIds[0]};
    await expect(correctMlpOpeningPairsAction(legacyId,selected.map((t,i)=>i?t:{...t,m1:t.w1,w1:t.m1}))).rejects.toThrow();
    await expect(correctMlpOpeningPairsAction(legacyId,selected.map((t,i)=>i?t:{...t,women1:t.men1}))).rejects.toThrow();
    for(const change of [{status:"completed" as const,scoreA:11,scoreB:8},{status:"void" as const},
      {scoreA:11},{enteredBy:actor.id},{editedAt:new Date()}]) {
      await db.update(matches).set(change).where(eq(matches.id,before[0].id));
      await expect(correctMlpOpeningPairsAction(legacyId,selected)).rejects.toThrow();
      await db.update(matches).set({status:"scheduled",scoreA:null,scoreB:null,enteredBy:null,editedAt:null}).where(eq(matches.id,before[0].id));
    }
    await db.insert(ratingEvents).values({matchId:before[0].id,playerId:before[0].a1,ratingBefore:3,ratingAfter:3,delta:0,k:0,surprise:0,reliabilityAtTime:0});
    await expect(correctMlpOpeningPairsAction(legacyId,selected)).rejects.toThrow();
    await db.delete(ratingEvents).where(eq(ratingEvents.matchId,before[0].id));
    expect(await db.select().from(matches).where(eq(matches.sessionId,legacyId))).toEqual(expect.arrayContaining(before));
    await correctMlpOpeningPairsAction(legacyId,selected);
    await assertSavedLineups(legacyId);
    const after=await db.select().from(matches).where(eq(matches.sessionId,legacyId));
    expect(after).toHaveLength(before.length);
    for(const old of before){
      const current=after.find(g=>g.id===old.id)!;
      if(old.mlpGame!.startsWith("mixed"))expect(current).toEqual(old);
      else {const {a1,a2,b1,b2,...meta}=old;void a1;void a2;void b1;void b2;expect(current).toMatchObject(meta);}
    }
    expect((await db.select().from(sessions).where(eq(sessions.id,legacyId)))[0].status).toBe("closed");
    await expect(correctMlpOpeningPairsAction(legacyId,selected)).rejects.toThrow();
    await expect(saveMlpTeamsAction(legacyId,selected)).rejects.toThrow();
    expect(await db.select().from(auditLog).where(and(eq(auditLog.targetId,legacyId),eq(auditLog.action,"mlp.correct_opening_pairs")))).toHaveLength(1);
  },120000);
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
    expect(backup.schema).toBe(2);expect(backup.mlpTies.filter(t=>t.sessionId===id)).toHaveLength(19);
    // Five courts: 12 RR waves + 2 semifinal + 2 gold/bronze.
    expect(backup.rounds.filter(r=>r.sessionId===id)).toHaveLength(16);
    expect(backup.players[0]).not.toHaveProperty("pinHash");expect(backup.players[0]).toHaveProperty("gender");
    const first=new Date("2026-09-25T00:00:00Z");
    await db.insert(ratingSeeds).values(personIds.slice(0,24).map(playerId=>({playerId,rating:3,source:"picker" as const,effectiveAt:first})));
    await db.update(sessions).set({rated:true}).where(eq(sessions.id,id));
    await Promise.all([recomputeAll(),recomputeAll()]);
    const ids=(await db.select({id:matches.id}).from(matches).where(eq(matches.sessionId,id))).map(m=>m.id);
    expect(await db.select().from(ratingEvents).where(inArray(ratingEvents.matchId,ids))).toHaveLength(76*4);
    const before=await db.select().from(playerStats).where(inArray(playerStats.playerId,personIds));
    await expect(inTransaction(async tx=>{await tx.delete(playerStats).where(inArray(playerStats.playerId,personIds));throw new Error("simulated rollback");})).rejects.toThrow("simulated rollback");
    expect(await db.select().from(playerStats).where(inArray(playerStats.playerId,personIds))).toEqual(before);
  },60000);
});

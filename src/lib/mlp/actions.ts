"use server";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { canOrganizeSession } from "@/lib/auth/policy";
import { requireOrganizer } from "@/lib/sessions/guards";
import { inTransaction, lockSession, type Transaction } from "@/lib/db/transaction";
import { auditLog, matches, mlpTeams, mlpTies, players, rounds, sessions, signups } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import { lineups, outcome, ROBIN_BLOCKS, standings, validateTeams, type Encounter, type Stage, type Team } from "./rules";

function refresh(id: string) {
  revalidatePath(`/s/${id}`); revalidatePath(`/s/${id}/play`);
}

async function organize<T>(id: string, work: (db: Transaction, actorId: string) => Promise<T>, live: boolean | null = true) {
  const { me } = await requireOrganizer(id);
  const t = await getT();
  return inTransaction(async db => {
    await lockSession(db, id);
    const [session] = await db.select().from(sessions).where(eq(sessions.id,id));
    if (!session || !canOrganizeSession(me,session)) throw new Error(t("err.notOrganizer"));
    if (session.format !== "mlp" || session.courtCount !== 4 || session.maxPlayers !== 24) {
      throw new Error(t("mlp.error.setup"));
    }
    if (live !== null && (live ? session.status !== "live" : !["open","live"].includes(session.status))) {
      throw new Error(t("err.startFirst"));
    }
    return work(db,me.id);
  });
}

export async function saveMlpTeamsAction(sessionId: string, input: unknown): Promise<void> {
  const t = await getT();
  await organize(sessionId, async db => {
    const existing = await db.select({id:rounds.id}).from(rounds).where(eq(rounds.sessionId,sessionId)).limit(1);
    if (existing.length) throw new Error(t("mlp.error.teamsLocked"));
    const roster = await db.select({id:players.id,gender:players.gender}).from(signups)
      .innerJoin(players,eq(players.id,signups.playerId))
      .where(and(eq(signups.sessionId,sessionId),eq(signups.state,"in"),eq(signups.attended,true)));
    if (roster.length !== 24 || !validateTeams(input,new Map(roster.map(p=>[p.id,p.gender])))) {
      throw new Error(t("mlp.error.teams"));
    }
    await db.delete(mlpTeams).where(eq(mlpTeams.sessionId,sessionId));
    await db.insert(mlpTeams).values(input.map((team,i)=>({
      sessionId,slot:i+1,name:team.name.trim(),m1:team.m1,m2:team.m2,w1:team.w1,w2:team.w2,
    })));
  },false);
  refresh(sessionId);
}

async function readEncounters(db: Transaction, sessionId: string): Promise<Encounter[]> {
  const ties = await db.select().from(mlpTies).where(eq(mlpTies.sessionId,sessionId)).orderBy(asc(mlpTies.index));
  const gs = await db.select().from(matches).where(eq(matches.sessionId,sessionId));
  return ties.map(t=>({...t,games:gs.filter(g=>g.mlpTieId===t.id).map(g=>({
    kind:g.mlpGame,scoreA:g.scoreA,scoreB:g.scoreB,status:g.status,
  }))}));
}

async function appendBlocks(db: Transaction, sessionId: string, teams: Team[],
  blocks: ReadonlyArray<ReadonlyArray<readonly [number,number]>>, stage: Stage) {
  const [lastRound] = await db.select({n:sql<number>`coalesce(max(${rounds.index}),0)::int`})
    .from(rounds).where(eq(rounds.sessionId,sessionId));
  const [lastTie] = await db.select({n:sql<number>`coalesce(max(${mlpTies.index}),0)::int`,
    block:sql<number>`coalesce(max(${mlpTies.block}),0)::int`})
    .from(mlpTies).where(eq(mlpTies.sessionId,sessionId));
  let nextTie = lastTie.n;
  const baseTime = Date.now();
  for (const [bi, block] of blocks.entries()) {
    const waveRows = await db.insert(rounds).values([0,1].map(w=>({
      sessionId,index:lastRound.n+bi*2+w+1,state:"active" as const,stage,
    }))).returning();
    waveRows.sort((a,b)=>a.index-b.index);
    for (const [ci,[ai,biTeam]] of block.entries()) {
      const a=teams[ai], b=teams[biTeam];
      const [tie] = await db.insert(mlpTies).values({sessionId,stage,index:++nextTie,
        block:lastTie.block+bi+1,teamAId:a.id,teamBId:b.id}).returning();
      await db.insert(matches).values(lineups(a,b).map((g,gi)=>({
        sessionId,roundId:waveRows[Math.floor(gi/2)].id,courtNo:ci*2+(gi%2)+1,
        a1:g.players[0],a2:g.players[1],b1:g.players[2],b2:g.players[3],
        mlpTieId:tie.id,mlpGame:g.kind,status:"scheduled" as const,
        // Sequential waves must replay in the same order even when one
        // transaction creates them all (Postgres now() would be identical).
        playedAt:new Date(baseTime+bi*2+Math.floor(gi/2)),
      })));
    }
  }
}

export async function createMlpScheduleAction(sessionId: string): Promise<void> {
  const t = await getT();
  await organize(sessionId,async db=>{
    const existing = await db.select({id:rounds.id}).from(rounds).where(eq(rounds.sessionId,sessionId)).limit(1);
    if (existing.length) throw new Error(t("mlp.error.teamsLocked"));
    const teams=await db.select().from(mlpTeams).where(eq(mlpTeams.sessionId,sessionId)).orderBy(asc(mlpTeams.slot));
    const roster=await db.select({id:players.id,gender:players.gender}).from(signups)
      .innerJoin(players,eq(players.id,signups.playerId)).where(and(eq(signups.sessionId,sessionId),
        eq(signups.state,"in"),eq(signups.attended,true)));
    if (roster.length!==24 || !validateTeams(teams,new Map(roster.map(p=>[p.id,p.gender])))) {
      throw new Error(t("mlp.error.teams"));
    }
    await appendBlocks(db,sessionId,teams,ROBIN_BLOCKS,"robin");
  });
  refresh(sessionId);
}

/** Remove only unplayed dependent stages to permit an upstream correction. */
export async function removeMlpPlayoffsAction(sessionId:string):Promise<void> {
  const t=await getT();
  await organize(sessionId,async db=>{
    const ties=await readEncounters(db,sessionId);
    const stage=ties.some(t=>t.stage==="final") ? "final" : "semifinal";
    const doomed=ties.filter(t=>t.stage===stage);
    if(!doomed.length || doomed.some(t=>t.games.some(g=>g.status!=="scheduled"))) {
      throw new Error(t("err.roundScored"));
    }
    await db.delete(mlpTies).where(inArray(mlpTies.id,doomed.map(t=>t.id)));
    await db.delete(rounds).where(and(eq(rounds.sessionId,sessionId),eq(rounds.stage,stage)));
  },null);
  refresh(sessionId);
}
export async function addMlpPlayoffAction(sessionId: string): Promise<void> {
  const t = await getT();
  await organize(sessionId,async db=>{
    const teams=await db.select().from(mlpTeams).where(eq(mlpTeams.sessionId,sessionId)).orderBy(asc(mlpTeams.slot));
    const ties=await readEncounters(db,sessionId);
    if (ties.some(t=>t.stage==="final")) throw new Error(t("err.finalsExist"));
    const semis=ties.filter(t=>t.stage==="semifinal");
    if (semis.length) {
      const winners=semis.map(s=>outcome(s).winner);
      if (semis.length!==2 || winners.some(w=>!w)) throw new Error(t("mlp.error.playoffReady"));
      const finalists=winners.map(id=>teams.find(t=>t.id===id)!);
      await appendBlocks(db,sessionId,finalists,[[[0,1]]],"final");
    } else {
      const robin=ties.filter(t=>t.stage==="robin");
      if (teams.length!==6 || robin.length!==15 || robin.some(r=>!outcome(r).winner)) {
        throw new Error(t("mlp.error.playoffReady"));
      }
      const seeds=standings(teams,robin).map(r=>r.team);
      await appendBlocks(db,sessionId,seeds,[[[0,3],[1,2]]],"semifinal");
    }
  });
  refresh(sessionId);
}

export async function setMlpTiebreakAction(sessionId: string, tieId: string, winner: string): Promise<void> {
  const t=await getT();
  await organize(sessionId,async (db,actorId)=>{
    const ties=await readEncounters(db,sessionId);
    const tie=ties.find(t=>t.id===tieId);
    if (!tie || ![tie.teamAId,tie.teamBId].includes(winner)) throw new Error(t("mlp.error.tie"));
    const result=outcome({...tie,tiebreakWinner:null});
    if (result.reason!=="tied") throw new Error(t("mlp.error.tie"));
    if (ties.some(other=>tie.stage==="robin" ? other.stage!=="robin" : tie.stage==="semifinal" && other.stage==="final")) {
      throw new Error(t("mlp.error.downstream"));
    }
    await db.update(mlpTies).set({tiebreakWinner:winner}).where(eq(mlpTies.id,tieId));
    await db.insert(auditLog).values({actorId,action:"mlp.tiebreak",targetType:"mlp_tie",targetId:tieId,
      detail:JSON.stringify({winner})});
  },null);
  refresh(sessionId);
}

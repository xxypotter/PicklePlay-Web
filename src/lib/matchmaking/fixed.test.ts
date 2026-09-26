import { expect, it } from "vitest";
import { fixedRound } from "./fixed";
import { applyRound, emptyHistory, generateRound, pairKey } from "./generator";
import { matchViolates } from "./gender";

it("keeps every assigned pair intact in incremental rounds and rotates rests by pair",()=>{
  const players=Array.from({length:12},(_,i)=>({id:String(i).padStart(2,"0"),partnerId:String(i^1).padStart(2,"0"),rating:2+i/3}));
  let history=emptyHistory();
  for(let i=0;i<9;i++) {
    const round=fixedRound(players,2,history);
    expect(round.courts).toHaveLength(2); expect(round.sittingOut).toHaveLength(4);
    for(const c of round.courts)for(const pair of [c.teamA,c.teamB])expect(players.find(p=>p.id===pair[0])?.partnerId).toBe(pair[1]);
    history=applyRound(history,round);
  }
  const counts=Object.values(history.gamesPlayed);
  expect(Math.max(...counts)-Math.min(...counts)).toBeLessThanOrEqual(1);
});
it("does not invent a pair for absent or unmatched partners",()=>{
  const players=[{id:"a",partnerId:"b",rating:3},{id:"b",partnerId:"a",rating:3},{id:"c",partnerId:"d",rating:3}];
  expect(fixedRound(players,2,emptyHistory()).courts).toHaveLength(0);
});
it("prefers unseen opposing pairs when possible",()=>{
  const players=Array.from({length:8},(_,i)=>({id:`p${i}`,partnerId:`p${i^1}`,rating:3}));
  let history=emptyHistory();const opponents=new Set<string>();
  for(let i=0;i<3;i++) {
    const round=fixedRound(players,2,history);
    for(const c of round.courts){const key=pairKey(c.teamA[0],c.teamB[0]);expect(opponents.has(key)).toBe(false);opponents.add(key);}
    history=applyRound(history,round);
  }
  expect(opponents.size).toBe(6);
});
it("gender is hard even when partner history and ratings overwhelm the old weight",()=>{
  for(let men=0;men<=12;men++) {
    const players=Array.from({length:12},(_,i)=>({id:`p${i}`,rating:2+i,gender:i<men?"male" as const:"female" as const}));
    const history=emptyHistory();
    for(const a of players)for(const b of players)if(a.gender!==b.gender)history.partnerCounts[pairKey(a.id,b.id)]=10000;
    const round=generateRound(players,3,history,{format:"gender",restarts:10});
    for(const c of round.courts){const g=(id:string)=>players.find(p=>p.id===id)!.gender;expect(matchViolates(g(c.teamA[0]),g(c.teamA[1]),g(c.teamB[0]),g(c.teamB[1]))).toBe(false);}
  }
});

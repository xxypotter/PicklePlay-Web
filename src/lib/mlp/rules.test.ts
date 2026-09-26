import { describe, expect, it } from "vitest";
import { GAME_KINDS, lineups, outcome, ROBIN_BLOCKS, standings, validateTeams, type Encounter, type Team } from "./rules";

const teams: Team[] = Array.from({length:6},(_,i)=>({id:`t${i}`,slot:i+1,name:`Team ${i+1}`,
  m1:`${i}m1`,m2:`${i}m2`,w1:`${i}w1`,w2:`${i}w2`}));
const encounter = (scores:number[][], extra:Partial<Encounter>={}): Encounter => ({
  id:"tie",index:1,block:1,stage:"robin",teamAId:"t0",teamBId:"t1",tiebreakWinner:null,
  games:scores.map(([scoreA,scoreB],i)=>({kind:GAME_KINDS[i],scoreA,scoreB,status:"completed"})),...extra,
});

describe("Mini MLP",()=>{
  it("plays every opponent once, with no double-booked players in either wave",()=>{
    const pairs=new Set<string>(), counts=new Map<string,number>();
    for(const block of ROBIN_BLOCKS){
      expect(block.length).toBeLessThanOrEqual(2);
      const waves=[new Set<string>(),new Set<string>()];
      for(const [a,b] of block){
        const key=[a,b].sort().join("|"); expect(pairs.has(key)).toBe(false); pairs.add(key);
        lineups(teams[a],teams[b]).forEach((g,gi)=>g.players.forEach(p=>{
          const wave=waves[Math.floor(gi/2)]; expect(wave.has(p)).toBe(false); wave.add(p);
          counts.set(p,(counts.get(p)??0)+1);
        }));
      }
    }
    expect(pairs.size).toBe(15); expect(counts.size).toBe(24);
    expect([...counts.values()]).toEqual(Array(24).fill(10));
  });
  it("keeps setup mixed partners against every opponent, including playoff encounters",()=>{
    for(const a of teams) for(const b of teams.filter(t=>t!==a)) {
      const games=lineups(a,b);
      expect(games[2].players).toEqual([a.m1,a.w1,b.m1,b.w1]);
      expect(games[3].players).toEqual([a.m2,a.w2,b.m2,b.w2]);
    }
  });
  it("validates six unique named teams, genders and all 24 distinct players",()=>{
    const roster=new Map(teams.flatMap(t=>[[t.m1,"male"],[t.m2,"male"],[t.w1,"female"],[t.w2,"female"]] as [string,string][]));
    expect(validateTeams(teams,roster)).toBe(true);
    expect(validateTeams(teams.slice(1),roster)).toBe(false);
    for(const changes of [{m1:teams[1].m1},{m1:teams[0].w1},{name:" "},{name:teams[1].name},{w1:"outsider"}]) {
      expect(validateTeams([{...teams[0],...changes},...teams.slice(1)],roster)).toBe(false);
    }
  });
  it("uses game wins first, then total points only at 2–2",()=>{
    expect(outcome(encounter([[11,10],[11,10],[11,10],[0,11]])).winner).toBe("t0");
    expect(outcome(encounter([[11,0],[11,0],[9,11],[9,11]])).reason).toBe("points");
    expect(outcome(encounter([[11,0],[11,0],[9,11],[9,11]])).winner).toBe("t0");
  });
  it("requires explicit organizer adjudication on exact ties",()=>{
    const tie=encounter([[11,8],[8,11],[11,8],[8,11]]);
    expect(outcome(tie)).toMatchObject({complete:true,winner:null,reason:"tied"});
    expect(outcome({...tie,tiebreakWinner:"t1"})).toMatchObject({winner:"t1",reason:"organizer"});
    expect(outcome({...tie,tiebreakWinner:"t5"}).winner).toBeNull();
  });
  it("does not resolve missing, duplicate, voided, or invalid games",()=>{
    const tie=encounter([[11,3],[11,3],[11,3],[11,3]]);
    for(const games of [tie.games.slice(1),[...tie.games.slice(1),tie.games[1]],
      tie.games.map((g,i)=>i===0?{...g,status:"void" as const}:g),
      tie.games.map((g,i)=>i===0?{...g,scoreA:3}:g),
      tie.games.map((g,i)=>i===0?{...g,scoreA:100}:g)]) {
      expect(outcome({...tie,games,tiebreakWinner:"t0"}).winner).toBeNull();
    }
  });
  it("seeds playoffs only from round robin; unfinished encounters do not award wins",()=>{
    const robin=encounter([[11,3],[11,3],[11,3],[11,3]]);
    const semi=encounter([[3,11],[3,11],[3,11],[3,11]],{stage:"semifinal"});
    expect(standings(teams,[robin,semi])).toEqual(standings(teams,[robin]));
    expect(standings(teams,[{...robin,games:robin.games.slice(0,3)}]).every(r=>r.wins===0)).toBe(true);
    expect(standings(teams,[robin])[0]).toMatchObject({team:teams[0],wins:1,played:1,gamesWon:4});
  });
});

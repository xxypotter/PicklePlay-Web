import { describe, expect, it } from "vitest";
import { GAME_KINDS, finalsOf, lineups, outcome, podium, robinBlocks, roundRobinReady, semiResults, standings, teamLineups, validMlpConfig, validateTeams, type Encounter, type Team } from "./rules";

const teams: Team[] = Array.from({length:6},(_,i)=>({id:`t${i}`,slot:i+1,name:`Team ${i+1}`,
  m1:`${i}m1`,m2:`${i}m2`,w1:`${i}w1`,w2:`${i}w2`,
  // Deliberately unlike the old position-derived opening pairs.
  women1:`${i}m1`,women2:`${i}w2`,men1:`${i}w1`,men2:`${i}m2`}));
const encounter = (scores:number[][], extra:Partial<Encounter>={}): Encounter => ({
  id:"tie",index:1,block:1,stage:"robin",teamAId:"t0",teamBId:"t1",tiebreakWinner:null,
  games:scores.map(([scoreA,scoreB],i)=>({kind:GAME_KINDS[i],scoreA,scoreB,status:"completed"})),...extra,
});

describe("Mini MLP",()=>{
  it.each([4,5,6])("%i teams: every opponent once, no double bookings, equal games and correct byes",(count)=>{
    const pairs=new Set<string>(), counts=new Map<string,number>();
    const blocks=robinBlocks(count);
    expect(blocks).toHaveLength(count===6?8:count===5?5:3);
    const byes=Array(count).fill(0);
    for(const block of blocks){
      const playing=new Set(block.flat());
      for(let i=0;i<count;i++) if(!playing.has(i)) byes[i]++;
      expect(block.length).toBeLessThanOrEqual(2);
      const waves=[new Set<string>(),new Set<string>()];
      for(const [a,b] of block){
        expect(a).toBeLessThan(count); expect(b).toBeLessThan(count); expect(a).not.toBe(b);
        const key=[a,b].sort().join("|"); expect(pairs.has(key)).toBe(false); pairs.add(key);
        lineups(teams[a],teams[b]).forEach((g,gi)=>g.players.forEach(p=>{
          const wave=waves[Math.floor(gi/2)]; expect(wave.has(p)).toBe(false); wave.add(p);
          counts.set(p,(counts.get(p)??0)+1);
        }));
      }
    }
    expect(pairs.size).toBe(count*(count-1)/2); expect(counts.size).toBe(count*4);
    expect([...counts.values()]).toEqual(Array(count*4).fill((count-1)*2));
    if(count===5) expect(byes).toEqual([1,1,1,1,1]);
    if(count===4) expect(byes).toEqual([0,0,0,0]);
  });
  // Longest run of consecutive blocks a team plays, and longest run it sits out.
  const streaks=(count:number)=>Array.from({length:count},(_,team)=>{
    let run=0,wait=0,maxRun=0,maxWait=0;
    for(const block of robinBlocks(count)){
      if(block.some(pair=>pair.includes(team))){run++;wait=0;}else{wait++;run=0;}
      maxRun=Math.max(maxRun,run); maxWait=Math.max(maxWait,wait);
    }
    return {maxRun,maxWait};
  });
  it("rest-balances six teams: nobody plays more than two blocks in a row or waits more than one",()=>{
    for(const s of streaks(6)){ expect(s.maxRun).toBeLessThanOrEqual(2); expect(s.maxWait).toBeLessThanOrEqual(1); }
  });
  it("five teams sit at the floor a single bye per block allows",()=>{
    // The first block's bye team must play the next four; nothing can do better.
    expect(Math.max(...streaks(5).map(s=>s.maxRun))).toBe(4);
    expect(Math.max(...streaks(5).map(s=>s.maxWait))).toBe(1);
  });
  it("keeps all four explicitly selected pairs against every opponent, including playoff encounters",()=>{
    for(const a of teams) for(const b of teams.filter(t=>t!==a)) {
      const games=lineups(a,b);
      expect(games[0].players).toEqual([a.women1,a.women2,b.women1,b.women2]);
      expect(games[1].players).toEqual([a.men1,a.men2,b.men1,b.men2]);
      expect(games[2].players).toEqual([a.m1,a.w1,b.m1,b.w1]);
      expect(games[3].players).toEqual([a.m2,a.w2,b.m2,b.w2]);
    }
  });
  it("preserves legacy draws while requiring explicit opening pairs for new setups",()=>{
    const legacy=teams.map(t=>({...t,women1:null,women2:null,men1:null,men2:null}));
    expect(teamLineups(legacy[0])).toEqual({women:["0w1","0w2"],men:["0m1","0m2"],mixed1:["0m1","0w1"],mixed2:["0m2","0w2"]});
    expect(validateTeams(legacy,new Set(legacy.flatMap(t=>[t.m1,t.m2,t.w1,t.w2])),6)).toBe(false);
  });
  it("rejects missing, duplicate, foreign-team and outsider opening selections",()=>{
    const roster=new Set(teams.flatMap(t=>[t.m1,t.m2,t.w1,t.w2]));
    for(const change of [{women1:""},{men1:null},{women1:teams[0].men1},{women2:teams[1].w1},{men2:"outsider"}]) {
      expect(validateTeams([{...teams[0],...change},...teams.slice(1)],roster,6)).toBe(false);
    }
  });
  it.each([4,5,6])("validates exactly %i teams using distinct roster members, without gender restrictions", count=>{
    const selected=teams.slice(0,count);
    const roster=new Set(selected.flatMap(t=>[t.m1,t.m2,t.w1,t.w2]));
    expect(validateTeams(selected,roster,count)).toBe(true);
    // Swap across historical gender-named slots; only membership matters now.
    expect(validateTeams([{...selected[0],m1:selected[0].w1,w1:selected[0].m1},...selected.slice(1)],roster,count)).toBe(true);
    expect(validateTeams(selected.slice(1),roster,count)).toBe(false);
    expect(validateTeams(selected,new Set([...roster,"extra"]),count)).toBe(false);
    for(const changes of [{m1:teams[1].m1},{m1:teams[0].w1},{name:" "},{name:teams[1].name},{w1:"outsider"}]) {
      expect(validateTeams([{...selected[0],...changes},...selected.slice(1)],roster,count)).toBe(false);
    }
  });
  it("rejects unsupported capacities/courts and schedules",()=>{
    for(const count of [4,5,6]) expect(validMlpConfig(4,count*4)).toBe(true);
    for(const count of [0,3,4.5,7,NaN]) {
      expect(validMlpConfig(4,count*4)).toBe(false);
      expect(()=>robinBlocks(count)).toThrow();
    }
    expect(validMlpConfig(3,16)).toBe(false);
    expect(validMlpConfig(5,20)).toBe(true);
    expect(validMlpConfig(6,24)).toBe(true);
    for(const courts of [0,3,4.5,7,NaN]) expect(validMlpConfig(courts,24)).toBe(false);
  });
  it.each([4,5,6])("%i teams: playoffs require every unique opponent, with all four games resolved",count=>{
    const selected=teams.slice(0,count);
    const ties=robinBlocks(count).flatMap((block,bi)=>block.map(([a,b],i)=>encounter(
      [[11,8],[11,8],[11,8],[11,8]],{id:`${bi}-${i}`,teamAId:selected[a].id,teamBId:selected[b].id},
    )));
    expect(roundRobinReady(selected,ties)).toBe(true);
    expect(roundRobinReady(selected,ties.slice(1))).toBe(false);
    expect(roundRobinReady(selected,[ties[1],...ties.slice(1)])).toBe(false);
    expect(roundRobinReady(selected,[{...ties[0],games:ties[0].games.slice(1)},...ties.slice(1)])).toBe(false);
    expect(roundRobinReady(selected,[{...ties[0],teamBId:"outsider"},...ties.slice(1)])).toBe(false);
    const tied={...ties[0],games:encounter([[11,8],[8,11],[11,8],[8,11]]).games};
    expect(roundRobinReady(selected,[tied,...ties.slice(1)])).toBe(true);
    expect(roundRobinReady(selected,[{...tied,tiebreakWinner:tied.teamAId},...ties.slice(1)])).toBe(true);
  });
  it("uses game wins first, then total points only at 2–2",()=>{
    expect(outcome(encounter([[11,10],[11,10],[11,10],[0,11]])).winner).toBe("t0");
    expect(outcome(encounter([[11,0],[11,0],[9,11],[9,11]])).reason).toBe("points");
    expect(outcome(encounter([[11,0],[11,0],[9,11],[9,11]])).winner).toBe("t0");
  });
  it("automatically draws exact RR ties, permits an override, and requires playoff winners",()=>{
    const tie=encounter([[11,8],[8,11],[11,8],[8,11]]);
    expect(outcome(tie)).toMatchObject({complete:true,winner:null,reason:"draw",resolved:true});
    expect(outcome({...tie,stage:"semifinal"})).toMatchObject({winner:null,reason:"tied",resolved:false});
    expect(outcome({...tie,stage:"final"})).toMatchObject({winner:null,reason:"tied",resolved:false});
    expect(outcome({...tie,tiebreakWinner:"t1"})).toMatchObject({winner:"t1",reason:"organizer"});
    expect(outcome({...tie,tiebreakWinner:"t5"}).winner).toBeNull();
  });
  it("counts draws for both teams and ranks by 2/1/0 points before game difference",()=>{
    const draw=encounter([[11,8],[8,11],[11,8],[8,11]]);
    const win=encounter([[11,0],[11,0],[11,0],[11,0]],{teamAId:"t2",teamBId:"t3"});
    const rows=standings(teams,[draw,{...draw,teamBId:"t4"},{...draw,teamBId:"t5"},win]);
    expect(rows[0]).toMatchObject({team:teams[0],wins:0,losses:0,draws:3,played:3,points:3});
    expect(rows[1]).toMatchObject({team:teams[2],wins:1,draws:0,points:2});
    const overridden=standings(teams,[{...draw,tiebreakWinner:"t1"}]);
    expect(overridden.find(r=>r.team.id==="t1")).toMatchObject({wins:1,losses:0,draws:0,points:2});
    expect(overridden.find(r=>r.team.id==="t0")).toMatchObject({wins:0,losses:1,draws:0,points:0});
    for(const row of rows) expect(row.played).toBe(row.wins+row.losses+row.draws);
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
  describe("playoffs with bronze",()=>{
    const win=[[11,5],[11,5],[11,5],[11,5]], lose=[[5,11],[5,11],[5,11],[5,11]];
    const semi1=encounter(win,{id:"s1",index:16,stage:"semifinal",teamAId:"t0",teamBId:"t3"});
    const semi2=encounter(lose,{id:"s2",index:17,stage:"semifinal",teamAId:"t1",teamBId:"t2"});
    it("pairs semifinal winners for gold and losers for bronze, only once both are decided",()=>{
      expect(semiResults([semi1,semi2])).toEqual({winners:["t0","t2"],losers:["t3","t1"]});
      expect(semiResults([semi2,semi1])).toEqual({winners:["t0","t2"],losers:["t3","t1"]});
      expect(semiResults([semi1])).toBeNull();
      expect(semiResults([semi1,{...semi2,games:semi2.games.slice(1)}])).toBeNull();
      const tied={...semi2,games:encounter([[11,8],[8,11],[11,8],[8,11]]).games};
      expect(semiResults([semi1,tied])).toBeNull();
      expect(semiResults([semi1,{...tied,tiebreakWinner:"t1"}])).toEqual({winners:["t0","t1"],losers:["t3","t2"]});
    });
    it("reads the first final drawn as gold and the second as bronze",()=>{
      const gold=encounter(win,{id:"g",index:18,stage:"final",teamAId:"t0",teamBId:"t2"});
      const bronze=encounter(lose,{id:"b",index:19,stage:"final",teamAId:"t3",teamBId:"t1"});
      expect(finalsOf([bronze,semi1,gold])).toEqual({gold,bronze});
      expect(finalsOf([semi1,semi2])).toEqual({gold:null,bronze:null});
      expect(podium([semi1,semi2,gold,bronze])).toEqual([{place:1,teamId:"t0"},{place:2,teamId:"t2"},{place:3,teamId:"t1"}]);
      // Each medal appears only once its own match is decided.
      const pending=(t:Encounter)=>({...t,games:t.games.slice(1)});
      expect(podium([gold,pending(bronze)])).toEqual([{place:1,teamId:"t0"},{place:2,teamId:"t2"}]);
      expect(podium([pending(gold),bronze])).toEqual([{place:3,teamId:"t1"}]);
    });
    it("still reads a final drawn before bronze existed as gold alone",()=>{
      const gold=encounter(win,{id:"g",index:18,stage:"final",teamAId:"t0",teamBId:"t2"});
      expect(finalsOf([gold])).toEqual({gold,bronze:null});
      expect(podium([gold])).toEqual([{place:1,teamId:"t0"},{place:2,teamId:"t2"}]);
    });
  });
});

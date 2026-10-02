import { describe, expect, it } from "vitest";
import { GAME_KINDS, lineups, robinBlocks, type Team } from "./rules";
import { roundRobinSchedule, twoCourtSchedule } from "./schedule";

const teams: Team[] = Array.from({length:6},(_,i)=>({id:`t${i}`,slot:i+1,name:`Team ${i+1}`,
  m1:`${i}a`,w1:`${i}b`,m2:`${i}c`,w2:`${i}d`,
  women1:`${i}a`,women2:`${i}d`,men1:`${i}b`,men2:`${i}c`}));
const cases = [4,5,6].flatMap(teams=>[4,5,6].map(courts=>({teams,courts})));

describe("Mini MLP court schedules",()=>{
  it.each(cases)("$teams teams / $courts courts: complete, collision-free and equal workloads",({teams:count,courts})=>{
    const plan=roundRobinSchedule(count,courts);
    const pairs=new Set<string>(),loads=new Map<string,number>();
    const waves=new Map<number,{courts:Set<number>;players:Set<string>;opponents:Map<number,number>}>();
    for(const tie of plan) {
      const [a,b]=tie.teams;
      expect(a).not.toBe(b);expect(Math.max(a,b)).toBeLessThan(count);
      const key=[a,b].sort().join("|");expect(pairs.has(key)).toBe(false);pairs.add(key);
      expect(tie.games.map(g=>g.kind).sort()).toEqual([...GAME_KINDS].sort());
      const opening=tie.games.filter(g=>g.kind==="women"||g.kind==="men");
      const mixed=tie.games.filter(g=>g.kind.startsWith("mixed"));
      expect(Math.max(...opening.map(g=>g.wave))).toBeLessThan(Math.min(...mixed.map(g=>g.wave)));
      for(const g of tie.games) {
        const wave=waves.get(g.wave)??{courts:new Set<number>(),players:new Set<string>(),opponents:new Map<number,number>()};
        waves.set(g.wave,wave);
        expect(g.court).toBeGreaterThanOrEqual(1);expect(g.court).toBeLessThanOrEqual(courts);
        expect(wave.courts.has(g.court)).toBe(false);wave.courts.add(g.court);
        for(const [team,opponent] of [[a,b],[b,a]]) {
          expect(wave.opponents.get(team)??opponent).toBe(opponent);wave.opponents.set(team,opponent);
        }
        for(const p of lineups(teams[a],teams[b]).find(x=>x.kind===g.kind)!.players) {
          expect(wave.players.has(p)).toBe(false);wave.players.add(p);loads.set(p,(loads.get(p)??0)+1);
        }
      }
    }
    expect(pairs.size).toBe(count*(count-1)/2);
    expect(loads.size).toBe(count*4);expect([...loads.values()]).toEqual(Array(count*4).fill((count-1)*2));
    const expectedWaves=count===4?6:count===5?10:courts===4?16:courts===5?12:10;
    expect([...waves.keys()].sort((a,b)=>a-b)).toEqual(Array.from({length:expectedWaves},(_,i)=>i));
    if(count===6&&courts>4) {
      for(const wave of waves.values()) expect(wave.courts.size).toBe(courts);
      for(const p of loads.keys()) expect([...waves.values()].filter(w=>!w.players.has(p))).toHaveLength(courts===5?2:0);
    }
  });
  it("preserves the existing four-court draw and playoff layout",()=>{
    for(const count of [4,5,6]) expect(roundRobinSchedule(count,4)).toEqual(twoCourtSchedule(robinBlocks(count)));
    const final=twoCourtSchedule([[[0,1],[2,3]]]);
    expect(final.map(t=>t.games.map(g=>g.court))).toEqual([[1,2,1,2],[3,4,3,4]]);
  });
  it("gives every team exactly one single-court encounter on five courts",()=>{
    const singles=roundRobinSchedule(6,5).filter(t=>t.games.every(g=>g.court===5));
    expect(singles.flatMap(t=>t.teams).sort()).toEqual([0,1,2,3,4,5]);
    expect(singles.map(t=>t.games.map(g=>g.wave))).toEqual([[0,1,2,3],[4,5,6,7],[8,9,10,11]]);
  });
  it("rejects unsupported counts rather than drawing an incomplete tournament",()=>{
    for(const [teams,courts] of [[3,4],[7,6],[6,3],[6,7],[6,4.5],[5,NaN]]) expect(()=>roundRobinSchedule(teams,courts)).toThrow();
  });
});

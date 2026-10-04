import { describe, expect, it } from "vitest";
import { filterSchedule } from "./schedule-filter";
import type { CurrentRound, RoundMatch } from "./queries";

const game=(id:string,completed=false,voided=false):RoundMatch=>({
  id,completed,voided,courtNo:1,courtLabel:"1",stageLabel:null,scoreA:completed?11:null,scoreB:completed?8:null,
  teamA:[{id:"a",username:"A",avatar:null},{id:"b",username:"B",avatar:null}],
  teamB:[{id:"c",username:"C",avatar:null},{id:"d",username:"D",avatar:null}],
});
const rounds:CurrentRound[]=[
  {id:"r1",index:1,stage:"robin",matches:[game("scored",true),game("pending")]},
  {id:"r2",index:2,stage:"semifinal",matches:[game("void",true,true)]},
  {id:"r3",index:3,stage:"final",matches:[game("later")]},
];
describe("schedule filters",()=>{
  it("restores all scored/voided matches when unchecked and preserves original order and numbering",()=>{
    const before=structuredClone(rounds);
    expect(filterSchedule(rounds,[],false)).toBe(rounds);
    expect(filterSchedule(rounds,[],true).map(r=>[r.index,r.matches.map(m=>m.id)])).toEqual([[1,["pending"]],[3,["later"]]]);
    expect(rounds).toEqual(before);
  });
  it("intersects all selected players with unscored matches",()=>{
    expect(filterSchedule(rounds,["a","d"],true).flatMap(r=>r.matches)).toHaveLength(2);
    expect(filterSchedule(rounds,["a","outsider"],true)).toEqual([]);
    expect(filterSchedule(rounds,["a"],false).flatMap(r=>r.matches)).toHaveLength(4);
  });
  it("responds to score saves and clears from refreshed props without hiding later rounds",()=>{
    const updated=structuredClone(rounds);
    updated[0].matches[1].completed=true;
    expect(filterSchedule(updated,[],true).map(r=>r.index)).toEqual([3]);
    updated[0].matches[0].completed=false;
    expect(filterSchedule(updated,[],true).flatMap(r=>r.matches).map(m=>m.id)).toEqual(["scored","later"]);
    expect(filterSchedule([{...rounds[0],matches:[game("done",true)]}],[],true)).toEqual([]);
  });
});

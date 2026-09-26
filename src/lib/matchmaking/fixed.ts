import { pairKey, type GenPlayer, type Round, type SessionHistory } from "./generator";

/** Pair membership is a constraint, never a reward in an individual-player search. */
export function fixedRound(players: (GenPlayer & {partnerId: string | null})[], courts: number,
  history: SessionHistory, random: () => number = Math.random): Round {
  const present = new Map(players.map(p=>[p.id,p]));
  const pairs = players.filter(p=>p.partnerId && p.id<p.partnerId && present.get(p.partnerId)?.partnerId===p.id)
    .map(p=>[p.id,p.partnerId!] as [string,string]);
  const count=Math.min(Math.floor(pairs.length/2),Math.max(0,courts));
  // Select whole pairs by games played; randomize equal workloads.
  const ranked=pairs.map(p=>({p,tie:random(),games:Math.max(...p.map(id=>history.gamesPlayed[id]??0))}))
    .sort((a,b)=>a.games-b.games || a.tie-b.tie).slice(0,count*2).map(x=>x.p);
  let best: [string,string][][] = [], bestCost=Infinity;
  const search=(remaining:[string,string][], draw:[string,string][][], cost:number)=>{
    if(cost>bestCost) return;
    if(!remaining.length) { if(cost<bestCost){bestCost=cost;best=draw;} return; }
    const a=remaining[0];
    for(let i=1;i<remaining.length;i++) {
      const b=remaining[i];
      const faced=Math.max(...a.flatMap(x=>b.map(y=>history.opponentCounts[pairKey(x,y)]??0)));
      search(remaining.filter((_,j)=>j!==0&&j!==i),[...draw,[a,b]],cost+faced*faced);
    }
  };
  search(ranked,[],0);
  const playing=new Set(best.flat(2));
  return {courts:best.map(([teamA,teamB],i)=>({courtNo:i+1,teamA,teamB})),sittingOut:players.filter(p=>!playing.has(p.id)).map(p=>p.id)};
}

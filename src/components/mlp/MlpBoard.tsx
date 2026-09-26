"use client";
import ConfirmAction from "./ConfirmAction";
import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import type { MlpData } from "@/lib/mlp/queries";
import { outcome, standings, type Encounter } from "@/lib/mlp/rules";
import { addMlpPlayoffAction, removeMlpPlayoffsAction, setMlpTiebreakAction } from "@/lib/mlp/actions";

export default function MlpBoard({data,sessionId,organizer=false,live=false}:{data:MlpData;sessionId:string;organizer?:boolean;live?:boolean}) {
  const t=useT(),[pending,start]=useTransition(),[error,setError]=useState("");
  const run=(fn:()=>Promise<void>)=>start(async()=>{setError("");try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}});
  const name=(id:string)=>data.teams.find(team=>team.id===id)?.name ?? "?";
  const semis=data.ties.filter(tie=>tie.stage==="semifinal"), final=data.ties.find(tie=>tie.stage==="final");
  const robin=data.ties.filter(tie=>tie.stage==="robin");
  const ready=!final && (semis.length===2 ? semis.every(s=>outcome(s).winner) : robin.length===15 && robin.every(r=>outcome(r).winner));
  const removable=(final?[final]:semis);
  const card=(tie:Encounter)=>{
    const result=outcome(tie);
    const downstream=tie.stage==="robin"?semis.length>0:tie.stage==="semifinal"?!!final:false;
    return <div key={tie.id} className="card-tight p-3">
      <p className="mb-2 text-xs text-[var(--muted)]">{t("mlp.encounter",{n:tie.index,block:tie.block})}</p>
      {[tie.teamAId,tie.teamBId].map((id,i)=><div key={id} className={`flex justify-between gap-3 ${result.winner===id?"font-bold text-[var(--accent)]":""}`}>
        <span>{name(id)} {result.winner===id?"✓":""}</span><span className="font-mono">{i===0?result.winsA:result.winsB}</span>
      </div>)}
      <p className="hint">{t("mlp.totalPoints",{a:result.pointsA,b:result.pointsB})} · {t(`mlp.result.${result.reason}`)}</p>
      {organizer&&!downstream&&["tied","organizer"].includes(result.reason)?<div className="mt-2 flex flex-wrap gap-2">
        {[tie.teamAId,tie.teamBId].map(id=><ConfirmAction key={id} label={t("mlp.chooseWinner",{name:name(id)})}
          confirmation={t("mlp.winnerConfirm",{name:name(id)})} disabled={pending} className="btn-ghost text-sm"
          onConfirm={()=>run(()=>setMlpTiebreakAction(sessionId,tie.id,id))} />)}
      </div>:null}
    </div>;
  };
  return <section className="mt-4 space-y-4">
    {error?<p role="alert" className="text-[var(--danger)]">{error}</p>:null}
    {semis.length>0?<section className="card">
      <h2 className="font-semibold">{t("mlp.playoffs")}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-2"><h3 className="label">{t("schedule.stage.semifinal")}</h3>{semis.map(card)}</div>
        <div className="space-y-2"><h3 className="label">{t("mlp.championship")}</h3>{final?card(final):<p className="hint">{t("mlp.finalPending")}</p>}</div>
      </div>
      {final&&outcome(final).winner?<p className="mt-4 font-bold">🏆 {name(outcome(final).winner!)}</p>:null}
    </section>:null}
    <section className="card overflow-x-auto">
      <h2 className="font-semibold">{t("mlp.standings")}</h2><p className="hint">{t("mlp.rankRule")}</p>
      <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-[var(--muted)]">
        <th className="py-2">#</th><th>{t("mlp.teamName")}</th><th>{t("mlp.wl")}</th><th>{t("mlp.games")}</th><th>+/−</th>
      </tr></thead><tbody>{standings(data.teams,data.ties).map((r,i)=><tr key={r.team.id} className="border-t border-[var(--border)] align-top">
        <td className="py-3 pr-2">{i+1}</td><td className="py-3 pr-2"><b>{r.team.name}</b>
          <p className="hint">{data.names[r.team.m1]} + {data.names[r.team.w1]}</p>
          <p className="hint">{data.names[r.team.m2]} + {data.names[r.team.w2]}</p>
        </td><td className="py-3 whitespace-nowrap">{r.wins}–{r.losses}</td><td className="py-3 whitespace-nowrap">{r.gamesWon}–{r.gamesLost}</td><td className="py-3">{r.pointsFor-r.pointsAgainst}</td>
      </tr>)}</tbody></table>
    </section>
    {organizer&&live&&!final?<div className="card"><p className="hint">{t("mlp.playoffHint")}</p>
      <ConfirmAction label={t(semis.length?"mlp.addFinal":"mlp.addSemis")} confirmation={t("mlp.playoffConfirm")}
        disabled={pending||!ready} onConfirm={()=>run(()=>addMlpPlayoffAction(sessionId))} />
    </div>:null}
    {organizer&&removable.length>0&&removable.every(tie=>tie.games.every(g=>g.status==="scheduled"))?
      <ConfirmAction label={t("mlp.removePlayoff")} confirmation={t("mlp.removeConfirm")} disabled={pending}
        className="btn-ghost w-full" onConfirm={()=>run(()=>removeMlpPlayoffsAction(sessionId))} />:null}
    {robin.length?<details><summary className="mb-2 cursor-pointer font-semibold">{t("mlp.results")}</summary><div className="grid gap-3 sm:grid-cols-2">{robin.map(card)}</div></details>:null}
  </section>;
}

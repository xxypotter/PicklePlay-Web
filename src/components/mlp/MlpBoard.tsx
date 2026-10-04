"use client";
import ConfirmAction from "./ConfirmAction";
import MlpDecision from "./MlpDecision";
import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import type { MlpData } from "@/lib/mlp/queries";
import { encounterCount, finalsOf, GAME_KINDS, outcome, podium, roundRobinReady, standings, teamLineups, type Encounter } from "@/lib/mlp/rules";
import { addMlpPlayoffAction, removeMlpPlayoffsAction } from "@/lib/mlp/actions";

export default function MlpBoard({data,sessionId,organizer=false,live=false}:{data:MlpData;sessionId:string;organizer?:boolean;live?:boolean}) {
  const t=useT(),[pending,start]=useTransition(),[error,setError]=useState("");
  const run=(fn:()=>Promise<void>)=>start(async()=>{setError("");try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}});
  const name=(id:string)=>data.teams.find(team=>team.id===id)?.name ?? "?";
  const semis=data.ties.filter(tie=>tie.stage==="semifinal");
  // Gold and bronze are drawn together, so one "final stage" covers both.
  const {gold,bronze}=finalsOf(data.ties);
  const finals=[gold,bronze].filter((tie):tie is Encounter=>tie!==null);
  const places=podium(data.ties);
  const robin=data.ties.filter(tie=>tie.stage==="robin");
  const ready=!gold && (semis.length===2 ? semis.every(s=>outcome(s).winner) : roundRobinReady(data.teams,robin));
  const removable=(finals.length?finals:semis);
  const card=(tie:Encounter)=>{
    const result=outcome(tie);
    const downstream=tie.stage==="robin"?semis.length>0:tie.stage==="semifinal"?!!gold:false;
    return <div key={tie.id} className="card-tight p-3">
      <p className="mb-2 text-xs text-[var(--muted)]">{t("mlp.encounter",{n:tie.index,block:tie.block})}</p>
      {[tie.teamAId,tie.teamBId].map((id,i)=><div key={id} className={`flex justify-between gap-3 ${result.winner===id?"font-bold text-[var(--accent)]":""}`}>
        <span>{name(id)} {result.winner===id?"✓":""}</span><span className="font-mono">{i===0?result.winsA:result.winsB}</span>
      </div>)}
      <p className="hint">{t("mlp.totalPoints",{a:result.pointsA,b:result.pointsB})} · {t(`mlp.result.${result.reason}`)}</p>
      {tie.decisionNote&&["organizer","draw"].includes(result.reason)?<p className="mt-2 whitespace-pre-wrap break-words text-sm">{tie.decisionNote}</p>:null}
      {organizer&&["tied","organizer","draw"].includes(result.reason)?<MlpDecision
        key={`${tie.id}:${tie.tiebreakWinner}:${tie.decisionNote}`}
        sessionId={sessionId} tie={tie} names={[name(tie.teamAId),name(tie.teamBId)]} locked={downstream} />:null}
    </div>;
  };
  return <section className="mt-4 space-y-4">
    {error?<p role="alert" className="text-[var(--danger)]">{error}</p>:null}
    {semis.length>0?<section className="card">
      <h2 className="font-semibold">{t("mlp.playoffs")}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-2"><h3 className="label">{t("schedule.stage.semifinal")}</h3>{semis.map(card)}</div>
        <div className="space-y-2">
          <h3 className="label">{t("mlp.championship")}</h3>
          {gold?card(gold):<p className="hint">{t("mlp.finalPending")}</p>}
          {bronze?<><h3 className="label pt-2">{t("mlp.bronze")}</h3>{card(bronze)}</>:null}
        </div>
      </div>
      {places.length?<ul className="mt-4 space-y-1 border-t border-[var(--border)] pt-3">
        {places.map(p=><li key={p.place} className="font-bold">{["🥇","🥈","🥉"][p.place-1]} {name(p.teamId)}</li>)}
      </ul>:null}
    </section>:null}
    <section className="card overflow-x-auto">
      <h2 className="font-semibold">{t("mlp.standings")}</h2>
      <p className="hint mt-1">{t("mlp.scoringRule")}</p>
      <p className="hint mt-1">{t("mlp.rankRule")}</p>
      <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-[var(--muted)]">
        <th className="py-2">#</th><th>{t("mlp.teamName")}</th><th className="px-2 whitespace-nowrap">{t("mlp.wl")}</th><th className="px-2">{t("mlp.points")}</th><th className="px-2">{t("mlp.games")}</th><th className="pl-2 whitespace-nowrap">+/−</th>
      </tr></thead><tbody>{standings(data.teams,data.ties).map((r,i)=><tr key={r.team.id} className="border-t border-[var(--border)] align-top">
        <td className="py-3 pr-2">{i+1}</td><td className="py-3 pr-2"><b>{r.team.name}</b>
          <details className="mt-1"><summary className="cursor-pointer text-xs text-[var(--muted)]">{t("mlp.viewPairs")}</summary>
            {GAME_KINDS.map(kind=><p key={kind} className="hint"><span className="font-medium">{t(`mlp.game.${kind}`)}:</span>{" "}
              {teamLineups(r.team)[kind].map(id=>data.names[id]).join(" + ")}</p>)}
          </details>
        </td><td className="px-2 py-3 whitespace-nowrap">{r.wins}–{r.losses}–{r.draws}</td><td className="px-2 py-3">{r.points}</td><td className="px-2 py-3 whitespace-nowrap">{r.gamesWon}–{r.gamesLost}</td><td className="py-3 pl-2">{r.pointsFor-r.pointsAgainst}</td>
      </tr>)}</tbody></table>
    </section>
    {organizer&&live&&!gold?<div className="card"><p className="hint">{t("mlp.playoffHint",{count:encounterCount(data.teams.length)})}</p>
      <ConfirmAction label={t(semis.length?"mlp.addFinal":"mlp.addSemis")} confirmation={t("mlp.playoffConfirm")}
        disabled={pending||!ready} onConfirm={()=>run(()=>addMlpPlayoffAction(sessionId))} />
    </div>:null}
    {organizer&&removable.length>0&&removable.every(tie=>tie.games.every(g=>g.status==="scheduled"))?
      <ConfirmAction label={t("mlp.removePlayoff")} confirmation={t("mlp.removeConfirm")} disabled={pending}
        className="btn-ghost w-full" onConfirm={()=>run(()=>removeMlpPlayoffsAction(sessionId))} />:null}
    {robin.length?<details open={organizer}><summary className="mb-2 cursor-pointer font-semibold">{t("mlp.results")}</summary><div className="grid gap-3 sm:grid-cols-2">{robin.map(card)}</div></details>:null}
  </section>;
}

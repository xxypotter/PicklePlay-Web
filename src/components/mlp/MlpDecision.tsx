"use client";

import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { setMlpTiebreakAction } from "@/lib/mlp/actions";
import type { Encounter } from "@/lib/mlp/rules";
import ConfirmAction from "./ConfirmAction";

/** Keyed by the stored decision/note so a server refresh shows the saved values. */
export default function MlpDecision({sessionId,tie,names,locked}:{
  sessionId:string;tie:Encounter;names:[string,string];locked:boolean;
}) {
  const t=useT();
  const savedDecision=tie.tiebreakWinner ?? (tie.stage==="robin"?"draw":"");
  const [decision,setDecision]=useState(savedDecision);
  const [note,setNote]=useState(tie.decisionNote??"");
  const [error,setError]=useState("");
  const [pending,start]=useTransition();
  const winnerName=decision===tie.teamAId?names[0]:names[1];
  const dirty=decision!==savedDecision || note.trim()!==(tie.decisionNote??"");
  return <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
    <label className="label" htmlFor={`decision-${tie.id}`}>{t("mlp.decision")}</label>
    <select id={`decision-${tie.id}`} className="field" value={decision} disabled={pending||locked} onChange={e=>setDecision(e.target.value)}>
      <option value="">{t("mlp.chooseDecision")}</option>
      {[tie.teamAId,tie.teamBId].map((id,i)=><option key={id} value={id}>{t("mlp.chooseWinner",{name:names[i]})}</option>)}
      {tie.stage==="robin"?<option value="draw">{t("mlp.draw")}</option>:null}
    </select>
    {locked?<p className="hint">{t("mlp.noteOnly")}</p>:null}
    <label className="label" htmlFor={`note-${tie.id}`}>{t("mlp.decisionNote")}</label>
    <textarea id={`note-${tie.id}`} className="field min-h-20" rows={2} maxLength={500} value={note}
      disabled={pending} placeholder={t("mlp.notePlaceholder")} onChange={e=>setNote(e.target.value)} />
    {error?<p role="alert" className="text-sm text-[var(--danger)]">{error}</p>:null}
    <ConfirmAction label={pending?t("common.saving"):t("mlp.saveDecision")}
      confirmation={decision==="draw"?t("mlp.resultDrawConfirm"):t("mlp.winnerConfirm",{name:winnerName})}
      disabled={pending||!decision||!dirty} onConfirm={()=>start(async()=>{
        setError("");
        try {await setMlpTiebreakAction(sessionId,tie.id,decision,note);} catch(e) {setError(e instanceof Error?e.message:String(e));}
      })} />
  </div>;
}

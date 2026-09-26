"use client";
import ConfirmAction from "./ConfirmAction";
import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { saveMlpTeamsAction, createMlpScheduleAction } from "@/lib/mlp/actions";
import type { Team, TeamInput } from "@/lib/mlp/rules";

export default function MlpSetup({sessionId,teams,roster,locked,live}:{sessionId:string;teams:Team[];
  roster:{id:string;username:string;gender?:string}[];locked:boolean;live:boolean}) {
  const t=useT();
  const [draft,setDraft]=useState<TeamInput[]>(()=>teams.length?teams:Array.from({length:6},(_,i)=>({
    name:t("mlp.teamDefault",{n:i+1}),m1:"",m2:"",w1:"",w2:"",
  })));
  const [pending,start]=useTransition(), [error,setError]=useState("");
  const run=(action:()=>Promise<void>)=>start(async()=>{
    setError("");try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}
  });
  if(locked) return <section className="card mt-3"><p className="hint">{t("mlp.locked")}</p></section>;
  const saved = teams.length===6 && draft.every((d,i)=>(["name","m1","m2","w1","w2"] as const).every(k=>d[k]===teams[i][k]));
  const used=new Set(draft.flatMap(d=>[d.m1,d.m2,d.w1,d.w2]).filter(Boolean));
  const set=(i:number,key:keyof TeamInput,value:string)=>setDraft(old=>old.map((d,j)=>i===j?{...d,[key]:value}:d));
  return <section className="card mt-3">
    <h2 className="font-semibold">{t("mlp.setup")}</h2><p className="hint">{t("mlp.setupHint")}</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {draft.map((team,i)=><fieldset key={i} disabled={pending} className="rounded-lg border border-[var(--border)] p-3">
        <legend className="px-1 text-sm">{t("mlp.teamDefault",{n:i+1})}</legend>
        <label className="label" htmlFor={`mlp-name-${i}`}>{t("mlp.teamName")}</label>
        <input id={`mlp-name-${i}`} className="field" value={team.name} maxLength={40} onChange={e=>set(i,"name",e.target.value)} />
        {[1,2].map(n=><div key={n} className="mt-3">
          <p className="text-sm font-medium">{t("mlp.pair",{n})}</p>
          {([`m${n}`,`w${n}`] as ("m1"|"m2"|"w1"|"w2")[]).map(key=><label key={key} className="mt-1 block text-sm">
            {t(key.startsWith("m")?"mlp.man":"mlp.woman")}
            <select className="field" value={team[key]} onChange={e=>set(i,key,e.target.value)}>
              <option value="">{t("mlp.choose")}</option>
              {roster.filter(p=>p.gender===(key.startsWith("m")?"male":"female"))
                .map(p=><option key={p.id} value={p.id} disabled={used.has(p.id)&&team[key]!==p.id}>{p.username}</option>)}
            </select>
          </label>)}
        </div>)}
      </fieldset>)}
    </div>
    {error?<p role="alert" className="mt-2 text-[var(--danger)]">{error}</p>:null}
    <button className="btn-primary mt-3 w-full" disabled={pending || roster.length!==24 || used.size!==24}
      onClick={()=>run(()=>saveMlpTeamsAction(sessionId,draft))}>{t("mlp.saveTeams")}</button>
    {live&&teams.length===6?<ConfirmAction label={t("mlp.createDraw")} confirmation={t("mlp.drawConfirm")}
      disabled={pending || !saved} onConfirm={()=>run(()=>createMlpScheduleAction(sessionId))} className="btn-ghost mt-2 w-full" />:null}
    <p className="hint">{t("mlp.setupCount",{n:roster.length})}</p>
  </section>;
}

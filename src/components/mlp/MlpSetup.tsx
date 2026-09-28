"use client";
import ConfirmAction from "./ConfirmAction";
import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { correctMlpOpeningPairsAction, saveMlpTeamsAction, createMlpScheduleAction } from "@/lib/mlp/actions";
import { members, OPENING_SLOTS, teamLineups, validateTeams, type Team, type TeamInput } from "@/lib/mlp/rules";

export default function MlpSetup({sessionId,teams,roster,locked,live,teamCount,canCorrectOpeningPairs=false}:{sessionId:string;teams:Team[];
  roster:{id:string;username:string;gender?:string}[];locked:boolean;live:boolean;teamCount:number;canCorrectOpeningPairs?:boolean}) {
  const t=useT();
  const [draft,setDraft]=useState<TeamInput[]>(()=>Array.from({length:teamCount},(_,i)=>{
    const saved=teams[i];
    if(!saved) return {name:t("mlp.teamDefault",{n:i+1}),m1:"",m2:"",w1:"",w2:"",women1:"",women2:"",men1:"",men2:""};
    const pairs=teamLineups(saved);
    return {...saved,women1:pairs.women[0],women2:pairs.women[1],men1:pairs.men[0],men2:pairs.men[1]};
  }));
  const [correcting,setCorrecting]=useState(false);
  const [pending,start]=useTransition(), [error,setError]=useState("");
  const run=(action:()=>Promise<void>)=>start(async()=>{
    setError("");try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}
  });
  if(locked && (!canCorrectOpeningPairs || !correcting)) return <section className="card mt-3">
    <p className="hint">{t("mlp.locked")}</p>
    {canCorrectOpeningPairs?<><p className="hint">{t("mlp.correctHint")}</p>
      <button className="btn-ghost mt-2 w-full" onClick={()=>setCorrecting(true)}>{t("mlp.correctPairs")}</button></>:null}
  </section>;
  const saved = teams.length===teamCount && draft.every((d,i)=>(["name","m1","m2","w1","w2",...OPENING_SLOTS] as const).every(k=>d[k]===teams[i][k]));
  const used=new Set(draft.flatMap(members).filter(Boolean));
  const ready=validateTeams(draft,new Set(roster.map(p=>p.id)),teamCount);
  const set=(i:number,key:keyof TeamInput,value:string)=>setDraft(old=>old.map((d,j)=>{
    if(i!==j)return d;
    const next={...d,[key]:value};
    // Changing the squad cannot leave a hidden selection from its old roster.
    if(["m1","m2","w1","w2"].includes(key)) for(const slot of OPENING_SLOTS) {
      if(!members(next).includes(next[slot]??"")) next[slot]="";
    }
    return next;
  }));
  return <section className="card mt-3">
    <h2 className="font-semibold">{t(correcting?"mlp.correctPairs":"mlp.setup")}</h2>
    <p className="hint">{t(correcting?"mlp.correctHint":"mlp.setupHint")}</p>
    <div className="mt-3 grid gap-3">
      {draft.map((team,i)=><fieldset key={i} disabled={pending} className="min-w-0 rounded-lg border border-[var(--border)] p-3">
        <legend className="px-1 text-sm">{t("mlp.teamDefault",{n:i+1})}</legend>
        <label className="label" htmlFor={`mlp-name-${i}`}>{t("mlp.teamName")}</label>
        <input id={`mlp-name-${i}`} className="field" value={team.name} maxLength={40} readOnly={correcting} onChange={e=>set(i,"name",e.target.value)} />
        {[1,2].map(n=><div key={n} className="mt-3">
          <p className="text-sm font-medium">{t(n===1?"mlp.game.mixed1":"mlp.game.mixed2")}</p>
          {([`w${n}`,`m${n}`] as ("m1"|"m2"|"w1"|"w2")[]).map(key=><label key={key} className="mt-1 block text-sm">
            {t("mlp.player",{n:key.startsWith("w")?1:2})}
            <select aria-label={`${team.name} ${t(n===1?"mlp.game.mixed1":"mlp.game.mixed2")} ${t("mlp.player",{n:key.startsWith("w")?1:2})}`}
              className="field" value={team[key]} disabled={correcting} onChange={e=>set(i,key,e.target.value)}>
              <option value="">{t("mlp.choose")}</option>
              {roster.map(p=><option key={p.id} value={p.id} disabled={used.has(p.id)&&team[key]!==p.id}>{p.username}</option>)}
            </select>
          </label>)}
        </div>)}
        <p className="hint mt-4">{t("mlp.openingHint")}</p>
        {(["women","men"] as const).map(kind=><div key={kind} className="mt-3">
          <p className="text-sm font-medium">{t(`mlp.game.${kind}`)}</p>
          {([1,2] as const).map(n=>{
            const key=`${kind}${n}` as (typeof OPENING_SLOTS)[number];
            return <label key={key} className="mt-1 block text-sm">{t("mlp.player",{n})}
              <select aria-label={`${team.name} ${t(`mlp.game.${kind}`)} ${t("mlp.player",{n})}`}
                className="field" value={team[key]??""} onChange={e=>set(i,key,e.target.value)}>
                <option value="">{t("mlp.choose")}</option>
                {roster.filter(p=>members(team).includes(p.id)).map(p=><option key={p.id} value={p.id}
                  disabled={OPENING_SLOTS.some(slot=>slot!==key&&team[slot]===p.id)}>{p.username}</option>)}
              </select>
            </label>;
          })}
        </div>)}
      </fieldset>)}
    </div>
    {error?<p role="alert" className="mt-2 text-[var(--danger)]">{error}</p>:null}
    {correcting?<>
      <ConfirmAction label={t("mlp.applyCorrection")} confirmation={t("mlp.correctConfirm")} disabled={pending||!ready}
        onConfirm={()=>run(async()=>{await correctMlpOpeningPairsAction(sessionId,draft);setCorrecting(false);})} className="btn-primary mt-3 w-full" />
      <button className="btn-ghost mt-2 w-full" disabled={pending} onClick={()=>setCorrecting(false)}>{t("mlp.cancel")}</button>
    </>:<>
      <button className="btn-primary mt-3 w-full" disabled={pending || !ready}
        onClick={()=>run(()=>saveMlpTeamsAction(sessionId,draft))}>{t("mlp.saveTeams")}</button>
      {live&&teams.length===teamCount?<ConfirmAction label={t("mlp.createDraw")} confirmation={t("mlp.drawConfirm")}
        disabled={pending || !saved || !ready} onConfirm={()=>run(()=>createMlpScheduleAction(sessionId))} className="btn-ghost mt-2 w-full" />:null}
      <p className="hint">{t("mlp.setupCount",{n:roster.length,total:teamCount*4,teams:teamCount})}</p>
    </>}
  </section>;
}

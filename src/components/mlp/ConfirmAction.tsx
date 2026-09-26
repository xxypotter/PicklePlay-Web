"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";

export default function ConfirmAction({label,confirmation,disabled,onConfirm,className="btn-primary mt-2 w-full"}:{
  label:string;confirmation:string;disabled?:boolean;onConfirm:()=>void;className?:string;
}) {
  const t=useT(),[armed,setArmed]=useState(false);
  return armed ? <div className="mt-2 rounded-lg border border-[var(--border)] p-3">
    <p className="text-sm">{confirmation}</p><div className="mt-2 flex gap-2">
      <button className="btn-primary flex-1" disabled={disabled} onClick={()=>{setArmed(false);onConfirm();}}>{t("mlp.confirm")}</button>
      <button className="btn-ghost flex-1" onClick={()=>setArmed(false)}>{t("mlp.cancel")}</button>
    </div>
  </div>:<button className={className} disabled={disabled} onClick={()=>setArmed(true)}>{label}</button>;
}

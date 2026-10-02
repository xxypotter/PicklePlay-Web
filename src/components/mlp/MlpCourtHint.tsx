"use client";
import { useT } from "@/lib/i18n/client";

export default function MlpCourtHint({teams,courts}:{teams:number;courts:string[]}) {
  const t=useT();
  if (teams===6&&courts.length===5) return <p className="hint">{t("mlp.fiveCourtsHint",{court:courts[4]})}</p>;
  if ((teams===4||teams===5)&&courts.length>4) return <p className="hint">{t("mlp.spareCourtsHint")}</p>;
  return null;
}

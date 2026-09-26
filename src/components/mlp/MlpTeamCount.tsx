"use client";

import { useT } from "@/lib/i18n/client";
import { MLP_TEAM_COUNTS } from "@/lib/mlp/rules";

/** Team count is persisted as capacity (four players per team). */
export default function MlpTeamCount({ players, onChange }: {
  players: string; onChange: (players: string) => void;
}) {
  const t = useT();
  return <div className="mb-3">
    <label className="label" htmlFor="mlp-team-count">{t("mlp.teamCount")}</label>
    <select id="mlp-team-count" className="field" value={Number(players)/4}
      onChange={e => onChange(String(Number(e.target.value)*4))}>
      {MLP_TEAM_COUNTS.map(n => <option key={n} value={n}>
        {t("mlp.teamCountOption", {teams:n,players:n*4})}
      </option>)}
    </select>
    <p className="hint">{t("mlp.teamCountHint")}</p>
  </div>;
}

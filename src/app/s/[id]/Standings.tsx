import Link from "next/link";
import Avatar from "@/components/Avatar";
import { getT } from "@/lib/i18n/server";
import type { StandingRow } from "@/lib/sessions/queries";

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * The session table from the rankings screen: rank, player, W–L with the wins
 * in orange, point difference, and rating movement. Top three get a medal
 * instead of a number, and your own row is tinted.
 */
export default async function Standings({
  rows,
  meId,
  backHere,
  locale,
}: {
  rows: StandingRow[];
  meId?: string;
  backHere: string;
  locale?: string | null;
}) {
  const t = await getT(locale);

  if (rows.length === 0) {
    return (
      <div className="card py-12 text-center">
        <p className="text-[var(--muted)]">{t("standings.empty")}</p>
        <p className="hint">{t("standings.emptyHint")}</p>
      </div>
    );
  }

  const showRating = rows.some((r) => r.ratingDelta !== null);

  return (
    <section className="card-tight overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
        <span className="w-7 shrink-0">{t("standings.rank")}</span>
        <span className="flex-1">{t("standings.player")}</span>
        <span className="w-12 text-center">{t("standings.wl")}</span>
        <span className="w-10 text-right">{t("standings.diff")}</span>
        {showRating ? <span className="w-14 text-right">{t("standings.rating")}</span> : null}
      </div>

      <ul>
        {rows.map((r, i) => {
          const diff = r.pointsFor - r.pointsAgainst;
          return (
            <li
              key={r.playerId}
              className={`flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0 ${
                r.playerId === meId ? "bg-[var(--accent-soft)]" : ""
              }`}
            >
              <span className="w-7 shrink-0 text-center text-sm tabular-nums">
                {MEDALS[i] ?? i + 1}
              </span>

              <Avatar username={r.username} avatar={r.avatar} size={28} />

              <Link
                href={`/p/${r.username}?from=${encodeURIComponent(backHere)}`}
                className="min-w-0 flex-1 truncate font-medium"
              >
                {r.username}
                {r.playerId === meId ? (
                  <span className="ml-1.5 rounded bg-[var(--accent)] px-1 py-0.5 text-[10px] font-semibold text-white">
                    {t("common.me")}
                  </span>
                ) : null}
              </Link>

              <span className="w-12 shrink-0 text-center text-sm tabular-nums">
                <span className="font-semibold text-[var(--accent)]">{r.wins}</span>
                <span className="text-[var(--muted)]">–{r.losses}</span>
              </span>

              <span className="w-10 shrink-0 text-right text-sm tabular-nums text-[var(--muted)]">
                {diff >= 0 ? "+" : ""}
                {diff}
              </span>

              {showRating ? (
                <span
                  className={`w-14 shrink-0 text-right font-mono text-xs tabular-nums ${
                    (r.ratingDelta ?? 0) >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"
                  }`}
                >
                  {r.ratingDelta === null
                    ? "—"
                    : `${r.ratingDelta >= 0 ? "+" : ""}${r.ratingDelta.toFixed(3)}`}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

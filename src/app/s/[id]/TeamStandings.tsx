import Avatar from "@/components/Avatar";
import { getT } from "@/lib/i18n/server";
import type { TeamRow } from "@/lib/sessions/team-view";

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * The table for a fixed-partner night, where the competitor is the pair.
 *
 * Ranking eight individuals hides the one thing the format is about — who was
 * playing with whom — and puts the medal on the wrong row: gold belongs to both
 * halves of the team that won it, not to whoever happened to have the best
 * personal record.
 *
 * Rating stays personal even here. A pair does not have a rating, and summing
 * or averaging two would invent a number nobody can find anywhere else, so each
 * player's movement is shown under their own name.
 */
export default async function TeamStandings({
  rows,
  meId,
  locale,
}: {
  rows: TeamRow[];
  meId?: string;
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

  const showRating = rows.some((r) => r.deltas.some((d) => d.delta !== null));
  const placed = rows.some((r) => r.placement !== null);

  return (
    <section className="card-tight overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
        <span className="w-7 shrink-0">{t("standings.rank")}</span>
        <span className="flex-1">{t("standings.team")}</span>
        <span className="w-12 text-center">{t("standings.wl")}</span>
        <span className="w-10 text-right">{t("standings.diff")}</span>
      </div>

      <ul>
        {rows.map((r, i) => {
          const diff = r.pointsFor - r.pointsAgainst;
          const mine = r.players.some((p) => p.id === meId);
          /*
           * Once a medal round has been played the medal follows the bracket,
           * not the record. Before that it falls back to table position, which
           * is what it has always meant.
           */
          const badge = r.placement !== null ? MEDALS[r.placement - 1] : placed ? null : MEDALS[i];

          return (
            <li
              key={r.team}
              className={`border-b border-[var(--border)] px-4 py-3 last:border-0 ${
                mine ? "bg-[var(--accent-soft)]" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-7 shrink-0 text-center text-sm tabular-nums">
                  {badge ?? (r.placement ?? i + 1)}
                </span>

                <div className="flex shrink-0 -space-x-2">
                  {r.players.map((p) => (
                    <span
                      key={p.id}
                      className="rounded-full ring-2 ring-[var(--surface)]"
                    >
                      <Avatar username={p.username} avatar={p.avatar} size={26} />
                    </span>
                  ))}
                </div>

                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {r.players.map((p) => p.username).join(" + ")}
                </span>

                <span className="w-12 shrink-0 text-center text-sm tabular-nums">
                  <span className="font-semibold text-[var(--accent)]">{r.wins}</span>
                  <span className="text-[var(--muted)]">–{r.losses}</span>
                </span>

                <span className="w-10 shrink-0 text-right text-sm tabular-nums text-[var(--muted)]">
                  {diff >= 0 ? "+" : ""}
                  {diff}
                </span>
              </div>

              {showRating ? (
                <p className="mt-1 pl-10 text-[11px] text-[var(--muted)]">
                  {r.deltas.map((d, n) => (
                    <span key={d.id}>
                      {n > 0 ? " · " : ""}
                      {d.username}{" "}
                      <span
                        className={`font-mono tabular-nums ${
                          (d.delta ?? 0) >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"
                        }`}
                      >
                        {d.delta === null
                          ? "—"
                          : `${d.delta >= 0 ? "+" : ""}${d.delta.toFixed(3)}`}
                      </span>
                    </span>
                  ))}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

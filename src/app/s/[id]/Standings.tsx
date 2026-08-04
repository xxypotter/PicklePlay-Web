import Link from "next/link";
import type { StandingRow } from "@/lib/sessions/queries";

/**
 * Tonight's table, not the all-time one.
 *
 * Mid-session nobody cares about their career rating — they care who's winning
 * right now. The global leaderboard stays one tap away for afterwards.
 */
export default function Standings({ rows, meId }: { rows: StandingRow[]; meId?: string }) {
  if (rows.length === 0) return null;

  return (
    <section className="card mt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-[var(--muted)]">Session standings</h2>
        <Link href="/leaderboard" className="text-xs font-semibold text-[var(--accent)] underline">
          All-time
        </Link>
      </div>

      <ul className="mt-2 divide-y divide-[var(--border)]">
        {rows.map((r, i) => {
          const diff = r.pointsFor - r.pointsAgainst;
          return (
            <li
              key={r.playerId}
              className={`flex items-center gap-3 py-2.5 ${
                r.playerId === meId ? "-mx-2 rounded-lg bg-[var(--accent)]/5 px-2" : ""
              }`}
            >
              <span className="w-4 shrink-0 text-sm text-[var(--muted)] tabular-nums">
                {i + 1}
              </span>
              <Link href={`/p/${r.username}`} className="min-w-0 flex-1 truncate font-medium">
                {r.username}
              </Link>
              <span className="shrink-0 text-sm tabular-nums">
                {r.wins}–{r.losses}
              </span>
              <span className="w-10 shrink-0 text-right text-sm text-[var(--muted)] tabular-nums">
                {diff >= 0 ? "+" : ""}
                {diff}
              </span>
              {r.ratingDelta !== null ? (
                <span
                  className={`w-14 shrink-0 text-right font-mono text-xs tabular-nums ${
                    r.ratingDelta >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"
                  }`}
                >
                  {r.ratingDelta >= 0 ? "+" : ""}
                  {r.ratingDelta.toFixed(3)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {/* An unrated session has no rating column, so don't promise one. */}
      <p className="hint mt-3">
        Won–lost and point difference
        {rows.some((r) => r.ratingDelta !== null) ? ", plus rating change from this session" : ""}.
      </p>
    </section>
  );
}

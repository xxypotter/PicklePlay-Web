import Avatar from "@/components/Avatar";
import { getT } from "@/lib/i18n/server";
import type { PairKey } from "@/lib/swiss/engine";
import { playoffLabel } from "@/lib/swiss/labels";
import type { SwissView } from "@/lib/swiss/view";

const MEDALS = ["🥇", "🥈", "🥉"];

const wins = (rec: string) => Number(rec.split("–")[0]) || 0;
const losses = (rec: string) => Number(rec.split("–")[1]) || 0;

/**
 * A Swiss night, read top to bottom in the order people ask about it: who
 * finished where, how the playoffs went, the Swiss table, then every round
 * grouped by record the way a CS Swiss stage is drawn — 1–0 games together,
 * 0–1 games together, so you can see why each pair met who it met.
 */
export default async function SwissPanel({
  view,
  meId,
  locale,
}: {
  view: SwissView;
  meId?: string;
  locale?: string | null;
}) {
  const t = await getT(locale);

  if (view.phase === "setup") {
    return (
      <div className="card py-12 text-center">
        <p className="text-[var(--muted)]">{t("swiss.notStarted")}</p>
        <p className="hint">{t("swiss.notStartedHint")}</p>
      </div>
    );
  }

  const names = (k: PairKey) => view.pairs[k]?.map((p) => p.username).join(" + ") ?? "?";
  const mine = (k: PairKey) => !!meId && !!view.pairs[k]?.some((p) => p.id === meId);

  // One line per pair, so full names fit on a phone. Winner bold, loser
  // muted; an unplayed game reads plainly on both lines.
  type GameLike = { a: PairKey; b: PairKey; scoreA: number | null; scoreB: number | null; status: string; winner: PairKey | null };
  const Line = ({ k, score, g }: { k: PairKey; score: number | null; g: GameLike }) => {
    const result = g.winner === null ? "open" : g.winner === k ? "won" : "lost";
    return (
      <div className={`flex items-center gap-2 text-sm ${
        result === "won" ? "font-semibold" : result === "lost" ? "text-[var(--muted)]" : ""
      } ${mine(k) ? "text-[var(--accent)]" : ""}`}
      >
        <span className="min-w-0 flex-1 truncate">{names(k)}</span>
        <span className="shrink-0 font-mono tabular-nums">{g.status === "completed" ? score : ""}</span>
      </div>
    );
  };
  const Game = ({ g }: { g: GameLike }) => (
    <div className={`py-1 ${g.status === "void" ? "line-through opacity-60" : ""}`}>
      <Line k={g.a} score={g.scoreA} g={g} />
      <Line k={g.b} score={g.scoreB} g={g} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {view.places ? (
        <section className="card-tight overflow-hidden">
          <h2 className="border-b border-[var(--border)] px-4 py-3 font-semibold">{t("swiss.places")}</h2>
          <ul>
            {view.places.map((k, i) => (
              <li
                key={k}
                className={`flex items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 last:border-0 ${
                  mine(k) ? "bg-[var(--accent-soft)]" : ""
                }`}
              >
                <span className="w-7 shrink-0 text-center text-sm tabular-nums">{MEDALS[i] ?? i + 1}</span>
                <span className="flex shrink-0 -space-x-2">
                  {view.pairs[k]?.map((p) => (
                    <span key={p.id} className="rounded-full ring-2 ring-[var(--surface)]">
                      <Avatar username={p.username} avatar={p.avatar} size={24} />
                    </span>
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{names(k)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.playoffs.length ? (
        <section className="card">
          <h2 className="font-semibold">{t("swiss.playoffs")}</h2>
          {[1, 2].map((wave) => {
            const games = view.playoffs.filter((g) => g.wave === wave);
            if (!games.length) return null;
            return (
              <div key={wave} className="mt-3">
                <h3 className="label">{t("swiss.playoffRound", { n: wave })}</h3>
                <div className="flex flex-col gap-2">
                  {games.map((g) => (
                    <div key={g.matchId} className="rounded-lg border border-[var(--border)] px-3 py-2">
                      <p className="text-xs text-[var(--muted)]">{playoffLabel(t, g.kind, g.place, g.leg)}</p>
                      <Game g={g} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="card-tight overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="font-semibold">{t("swiss.standings")}</h2>
          <p className="hint mt-0.5">{t("swiss.rankRule")}</p>
        </div>
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
          <span className="w-6 shrink-0">{t("standings.rank")}</span>
          <span className="flex-1">{t("standings.team")}</span>
          <span className="w-10 text-center">{t("standings.wl")}</span>
          <span className="w-9 text-center">{t("swiss.buchholz")}</span>
          <span className="w-9 text-right">{t("standings.diff")}</span>
        </div>
        <ul>
          {view.standings.map((r) => {
            const diff = r.pointsFor - r.pointsAgainst;
            return (
              <li
                key={r.key}
                className={`flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5 last:border-0 ${
                  mine(r.key) ? "bg-[var(--accent-soft)]" : ""
                }`}
              >
                <span className="w-6 shrink-0 text-sm tabular-nums">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {names(r.key)}
                  {r.byes ? <span className="ml-1 text-xs text-[var(--muted)]">{t("swiss.byeMark")}</span> : null}
                </span>
                <span className="w-10 shrink-0 text-center text-sm tabular-nums">
                  <span className="font-semibold text-[var(--accent)]">{r.wins}</span>
                  <span className="text-[var(--muted)]">–{r.losses}</span>
                </span>
                <span className="w-9 shrink-0 text-center text-sm tabular-nums text-[var(--muted)]">{r.buchholz}</span>
                <span className="w-9 shrink-0 text-right text-sm tabular-nums text-[var(--muted)]">
                  {diff >= 0 ? "+" : ""}
                  {diff}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2 className="font-semibold">{t("swiss.board")}</h2>
        <p className="hint mt-0.5">{t("swiss.boardHint")}</p>
        <p className="hint mt-0">{t(view.seeded ? "swiss.seededNote" : "swiss.randomNote")}</p>
        {view.rounds.map((round) => {
          // Grouped by the higher pair's record; a pair that moved groups is marked.
          const groups = [...new Set(round.games.map((g) => g.recordA))]
            .sort((x, y) => wins(y) - wins(x) || losses(x) - losses(y));
          return (
            <div key={round.number} className="mt-4">
              <h3 className="text-sm font-semibold">{t("play.roundHeading", { index: round.number })}</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {groups.map((rec) => (
                  <div key={rec} className="rounded-lg border border-[var(--border)] px-3 py-2">
                    <p className="text-xs font-semibold text-[var(--muted)]">{rec}</p>
                    <div className="divide-y divide-[var(--border)]">
                    {round.games.filter((g) => g.recordA === rec).map((g) => (
                      <div key={g.matchId}>
                        <Game g={g} />
                        {g.recordB !== g.recordA ? (
                          <p className="text-[11px] text-[var(--muted)]">{t("swiss.moved", { record: g.recordB })}</p>
                        ) : null}
                      </div>
                    ))}
                    </div>
                  </div>
                ))}
              </div>
              {round.bye ? (
                <p className="hint mt-1">{t("swiss.bye", { pair: names(round.bye), record: round.byeRecord ?? "" })}</p>
              ) : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}

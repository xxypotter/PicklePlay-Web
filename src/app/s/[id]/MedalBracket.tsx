import Avatar from "@/components/Avatar";
import { getT } from "@/lib/i18n/server";
import type { RoundPlayer } from "@/lib/sessions/queries";
import type { Bracket, BracketMatch } from "@/lib/sessions/team-view";

/**
 * How the night was decided.
 *
 * The standings table says who has the best record; it does not say who won the
 * final, and on a real night those were different teams. So the bracket goes
 * above the table and shows the thing people actually want to know — printed as
 * the four matches that decided it, with the winner of each marked.
 *
 * Laid out as a column rather than the usual left-to-right tree: the audience is
 * a phone held in one hand, and a two-round bracket reads perfectly well as
 * "these two games, then these two".
 */
export default async function MedalBracket({
  bracket,
  meId,
  locale,
}: {
  bracket: Bracket;
  meId?: string;
  locale?: string | null;
}) {
  const t = await getT(locale);

  const title: Record<BracketMatch["label"], string> = {
    semi1: t("match.semifinal", { index: 1 }),
    semi2: t("match.semifinal", { index: 2 }),
    gold: t("match.gold"),
    bronze: t("match.bronze"),
  };

  const podium = placings(bracket);

  return (
    <section className="card mb-3">
      <h2 className="mb-2 text-sm font-semibold">{t("bracket.title")}</h2>

      <div className="flex flex-col gap-2">
        {bracket.semis.map((m) => (
          <Fixture key={m.label} match={m} title={title[m.label]} meId={meId} unplayed={t("bracket.unplayed")} />
        ))}

        {bracket.finals.length > 0 ? (
          <>
            {/* The join between the two stages, so the flow is visible. */}
            <p className="py-0.5 text-center text-xs text-[var(--muted)]">
              {t("bracket.thenFinals")}
            </p>
            {bracket.finals.map((m) => (
              <Fixture
                key={m.label}
                match={m}
                title={title[m.label]}
                meId={meId}
                unplayed={t("bracket.unplayed")}
              />
            ))}
          </>
        ) : (
          <p className="hint">{t("bracket.awaitingFinals")}</p>
        )}
      </div>

      {podium.length > 0 ? (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <ul className="flex flex-col gap-1">
            {podium.map(({ medal, players }) => (
              <li key={medal} className="flex items-center gap-2 text-sm">
                <span className="w-5 shrink-0 text-center">{medal}</span>
                <span className="flex shrink-0 -space-x-2">
                  {players.map((p) => (
                    <span key={p.id} className="rounded-full ring-2 ring-[var(--surface)]">
                      <Avatar username={p.username} avatar={p.avatar} size={20} />
                    </span>
                  ))}
                </span>
                <span className="min-w-0 truncate font-medium">
                  {players.map((p) => p.username).join(" + ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** One match of the bracket: two teams, a score, and a tick on the winner. */
function Fixture({
  match,
  title,
  meId,
  unplayed,
}: {
  match: BracketMatch;
  title: string;
  meId?: string;
  unplayed: string;
}) {
  const decided = match.completed && match.scoreA !== null && match.scoreB !== null;
  const aWon = decided && (match.scoreA as number) > (match.scoreB as number);

  return (
    <div className="rounded-xl border border-[var(--border)] px-2.5 py-2">
      <p className="mb-1 text-[11px] font-semibold text-[var(--muted)]">{title}</p>
      <Line players={match.teamA} score={match.scoreA} won={decided && aWon} meId={meId} />
      <Line players={match.teamB} score={match.scoreB} won={decided && !aWon} meId={meId} />
      {!decided ? <p className="mt-0.5 text-[11px] text-[var(--muted)]">{unplayed}</p> : null}
    </div>
  );
}

function Line({
  players,
  score,
  won,
  meId,
}: {
  players: RoundPlayer[];
  score: number | null;
  won: boolean;
  meId?: string;
}) {
  const mine = players.some((p) => p.id === meId);
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="flex shrink-0 -space-x-2">
        {players.map((p) => (
          <span key={p.id} className="rounded-full ring-2 ring-[var(--surface)]">
            <Avatar username={p.username} avatar={p.avatar} size={18} />
          </span>
        ))}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${won ? "font-bold" : ""} ${
          mine ? "text-[var(--accent)]" : ""
        }`}
      >
        {players.map((p) => p.username).join(" + ")}
      </span>
      <span
        className={`shrink-0 font-mono text-sm tabular-nums ${
          won ? "font-bold text-[var(--accent)]" : "text-[var(--muted)]"
        }`}
      >
        {score ?? "—"}
      </span>
    </div>
  );
}

/** Gold, silver, bronze — only once the match that decides each is played. */
function placings(bracket: Bracket): Array<{ medal: string; players: RoundPlayer[] }> {
  const out: Array<{ medal: string; players: RoundPlayer[] }> = [];

  for (const match of bracket.finals) {
    if (!match.completed || match.scoreA === null || match.scoreB === null) continue;
    const aWon = match.scoreA > match.scoreB;
    const winner = aWon ? match.teamA : match.teamB;
    const loser = aWon ? match.teamB : match.teamA;

    if (match.label === "gold") {
      out.push({ medal: "🥇", players: winner }, { medal: "🥈", players: loser });
    } else {
      out.push({ medal: "🥉", players: winner });
    }
  }

  // Gold match first if both are in, so the list reads 1st, 2nd, 3rd.
  return out.sort((a, b) => "🥇🥈🥉".indexOf(a.medal) - "🥇🥈🥉".indexOf(b.medal));
}

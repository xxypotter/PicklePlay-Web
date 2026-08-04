import type { CurrentRound } from "@/lib/sessions/queries";

/**
 * The matchups screen: an amber lozenge separating each round, then one card
 * per court — both teams either side of "vs", court and score on the right
 * with the winner's number in orange.
 */
export default function Schedule({
  rounds,
  meId,
  courtCount,
}: {
  rounds: CurrentRound[];
  meId?: string;
  courtCount: number;
}) {
  if (rounds.length === 0) {
    return (
      <div className="card py-12 text-center">
        <p className="text-[var(--muted)]">No matches yet.</p>
        <p className="hint">The organizer builds the schedule when play starts.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {rounds.map((round) => (
        <section key={round.id}>
          <p className="round-chip w-fit">
            Round {round.index} · {courtCount} court{courtCount === 1 ? "" : "s"}
          </p>

          <div className="mt-3 flex flex-col gap-2.5">
            {round.matches.map((m) => {
              const mine = [...m.teamA, ...m.teamB].some((p) => p.id === meId);
              const aWon = m.completed && (m.scoreA ?? 0) > (m.scoreB ?? 0);

              return (
                <div
                  key={m.id}
                  className={`card flex items-center gap-3 ${
                    mine ? "ring-1 ring-[var(--accent)]" : ""
                  }`}
                >
                  <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <Team players={m.teamA} meId={meId} />
                    <span className="text-xs text-[var(--muted)]">vs</span>
                    <Team players={m.teamB} meId={meId} align="right" />
                  </div>

                  <div className="shrink-0 border-l border-[var(--border)] pl-3 text-right">
                    <p className="text-[11px] text-[var(--muted)]">{m.courtLabel}</p>
                    {m.completed ? (
                      <p className="font-mono text-base tabular-nums">
                        <span className={aWon ? "font-bold text-[var(--accent)]" : ""}>
                          {m.scoreA}
                        </span>
                        <span className="text-[var(--muted)]"> : </span>
                        <span className={!aWon ? "font-bold text-[var(--accent)]" : ""}>
                          {m.scoreB}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">—</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function Team({
  players,
  meId,
  align = "left",
}: {
  players: { id: string; username: string }[];
  meId?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={`min-w-0 text-sm ${align === "right" ? "text-right" : ""}`}>
      {players.map((p) => (
        <p
          key={p.id}
          className={`truncate ${p.id === meId ? "font-bold text-[var(--accent)]" : ""}`}
        >
          {p.id === meId ? "You" : p.username}
        </p>
      ))}
    </div>
  );
}

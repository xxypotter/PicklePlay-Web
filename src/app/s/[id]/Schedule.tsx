import Avatar from "@/components/Avatar";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translate";
import type { CurrentRound, RoundPlayer } from "@/lib/sessions/queries";
import MatchCard from "./MatchCard";

/**
 * The matchups screen, and the only place scores are entered.
 *
 * Rounds don't get played in the order they were generated — courts free up out
 * of sequence — so there's no "your next match" to pin. You find the match you
 * played and put the score in. Matches you were in open with steppers; the rest
 * are read-only, which also makes your own stand out in a long list.
 *
 * Both permissions are passed in rather than inferred from "is this mine",
 * because being in a match stops being enough once the session closes — a
 * finished night is a record, and only its organizer may still amend it.
 */
export default async function Schedule({
  rounds,
  meId,
  canScoreAny = false,
  canScoreMine = false,
  locale,
}: {
  rounds: CurrentRound[];
  meId?: string;
  /** May score a match you weren't in — an admin on the night, or the organizer. */
  canScoreAny?: boolean;
  /** May score a match you played in. False once the session is closed. */
  canScoreMine?: boolean;
  locale?: string | null;
}) {
  const t = await getT(locale);

  if (rounds.length === 0) {
    return (
      <div className="card py-12 text-center">
        <p className="text-[var(--muted)]">{t("schedule.empty")}</p>
        <p className="hint">{t("schedule.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {rounds.map((round) => (
        <section key={round.id}>
          <p className="round-chip w-fit">
            {/*
              Courts in use this round, which is one per match — not the
              session's court count. A round can hold fewer matches than the
              venue has courts, and saying "2 courts" over a single game is
              simply untrue.
            */}
            {t.plural("schedule.round", round.matches.length, {
              index: round.index,
              count: round.matches.length,
            })}
          </p>

          <div className="mt-3 flex flex-col gap-2.5">
            {round.matches.map((m) => {
              const mine = [...m.teamA, ...m.teamB].some((p) => p.id === meId);

              if (canScoreAny || (mine && canScoreMine)) {
                return (
                  <MatchCard
                    key={m.id}
                    match={m}
                    meId={meId}
                    canVoid={canScoreAny}
                    highlight={mine}
                  />
                );
              }

              const aWon = m.completed && (m.scoreA ?? 0) > (m.scoreB ?? 0);
              return (
                /*
                  Mark your own games here too, not only while they're editable.
                  The highlight used to come with the score box, so it vanished
                  the moment a session closed — which is exactly when people come
                  back to look, and a finished night can be fifteen cards long.
                */
                <div
                  key={m.id}
                  className={`card flex items-center gap-3 ${
                    mine ? "border-2 border-[var(--accent)]" : ""
                  }`}
                >
                  <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <Team players={m.teamA} meId={meId} t={t} />
                    <span className="text-xs text-[var(--muted)]">{t("schedule.vs")}</span>
                    <Team players={m.teamB} meId={meId} t={t} align="right" />
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

/**
 * Avatars sit next to the names so you can spot your court at a glance rather
 * than reading four usernames. The right-hand team mirrors so both avatars hug
 * the centre "vs" and the names stay on the outside.
 */
function Team({
  players,
  meId,
  t,
  align = "left",
}: {
  players: RoundPlayer[];
  meId?: string;
  t: T;
  align?: "left" | "right";
}) {
  const mirrored = align === "right";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {players.map((p) => (
        <div
          key={p.id}
          className={`flex min-w-0 items-center gap-1.5 ${mirrored ? "flex-row-reverse" : ""}`}
        >
          <Avatar username={p.username} avatar={p.avatar} size={20} />
          <span
            className={`truncate text-sm ${
              p.id === meId ? "font-bold text-[var(--accent)]" : ""
            }`}
          >
            {p.id === meId ? t("common.you") : p.username}
          </span>
        </div>
      ))}
    </div>
  );
}

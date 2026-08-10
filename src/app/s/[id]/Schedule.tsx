"use client";

import { useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import { useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n/translate";
import type { CurrentRound, RoundMatch, RoundPlayer } from "@/lib/sessions/queries";
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
 *
 * A client component so the filter can be instant. Everything it needs is
 * already resolved server-side into plain strings by `getAllRounds`, so this
 * costs a serialized payload rather than a round trip.
 */
export default function Schedule({
  rounds,
  meId,
  canScoreAny = false,
  canScoreMine = false,
}: {
  rounds: CurrentRound[];
  meId?: string;
  /** May score a match you weren't in — an admin on the night, or the organizer. */
  canScoreAny?: boolean;
  /** May score a match you played in. False once the session is closed. */
  canScoreMine?: boolean;
}) {
  const t = useT();
  const [picked, setPicked] = useState<string[]>([]);

  const everyone = useMemo(() => rosterOf(rounds), [rounds]);

  /*
   * Show the games that involve *all* the picked players.
   *
   * Intersection rather than union, because the question people actually ask is
   * "when am I on court with you" — a union would just add your games to mine
   * and answer nothing. With one player picked the two are the same thing, so
   * the simple case still reads as "show me my games".
   */
  const shown = useMemo(() => {
    if (picked.length === 0) return rounds;
    return rounds
      .map((round) => ({
        ...round,
        matches: round.matches.filter((m) => picked.every((id) => inMatch(m, id))),
      }))
      .filter((round) => round.matches.length > 0);
  }, [rounds, picked]);

  const matchCount = shown.reduce((n, r) => n + r.matches.length, 0);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

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
      <section className="card-tight px-3 py-3">
        {/* Horizontal strip: a nine-player roster doesn't fit on a phone. */}
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {everyone.map((p) => {
            const on = picked.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                aria-pressed={on}
                className={`flex w-14 shrink-0 flex-col items-center gap-1 rounded-lg py-1.5
                  transition ${on ? "bg-[var(--accent-soft)]" : "active:opacity-60"}`}
              >
                <span
                  className={
                    on ? "rounded-full ring-2 ring-[var(--accent)] ring-offset-1" : undefined
                  }
                >
                  <Avatar username={p.username} avatar={p.avatar} size={34} />
                </span>
                <span
                  className={`w-full truncate px-0.5 text-center text-[10px] ${
                    on ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"
                  }`}
                >
                  {p.id === meId ? t("schedule.filterYou") : p.username}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-1 flex items-baseline justify-between gap-2 px-1">
          <p className="hint">
            {picked.length === 0
              ? t("schedule.filterHint")
              : summary(t, picked, shown, matchCount)}
          </p>
          {picked.length > 0 ? (
            <button
              type="button"
              onClick={() => setPicked([])}
              className="shrink-0 text-xs font-semibold text-[var(--accent)]"
            >
              {t("schedule.filterClear")}
            </button>
          ) : null}
        </div>
      </section>

      {matchCount === 0 ? (
        <p className="card py-10 text-center text-sm text-[var(--muted)]">
          {t("schedule.filterNone")}
        </p>
      ) : null}

      {shown.map((round) => (
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
                  <MatchCard key={m.id} match={m} meId={meId} canVoid={canScoreAny} highlight={mine} />
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
                    <Team players={m.teamA} meId={meId} picked={picked} t={t} />
                    <span className="text-xs text-[var(--muted)]">{t("schedule.vs")}</span>
                    <Team players={m.teamB} meId={meId} picked={picked} t={t} align="right" />
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

const inMatch = (m: RoundMatch, id: string) =>
  m.teamA.some((p) => p.id === id) || m.teamB.some((p) => p.id === id);

/** Everyone who appears anywhere in the schedule, in first-appearance order. */
function rosterOf(rounds: CurrentRound[]): RoundPlayer[] {
  const seen = new Map<string, RoundPlayer>();
  for (const round of rounds) {
    for (const m of round.matches) {
      for (const p of [...m.teamA, ...m.teamB]) if (!seen.has(p.id)) seen.set(p.id, p);
    }
  }
  return [...seen.values()];
}

/**
 * What the filter found.
 *
 * For exactly two players the useful split is partners versus opponents — "four
 * games together" and "four against each other" are different answers to the
 * question people are asking when they tap two faces.
 */
function summary(t: T, picked: string[], shown: CurrentRound[], total: number): string {
  const count = t.plural("schedule.filterCount", total, { count: total });
  if (picked.length !== 2) return count;

  let together = 0;
  for (const round of shown) {
    for (const m of round.matches) {
      const sameSide =
        picked.every((id) => m.teamA.some((p) => p.id === id)) ||
        picked.every((id) => m.teamB.some((p) => p.id === id));
      if (sameSide) together++;
    }
  }
  return `${count} · ${t("schedule.filterTogether", { together, against: total - together })}`;
}

/**
 * Avatars sit next to the names so you can spot your court at a glance rather
 * than reading four usernames. The right-hand team mirrors so both avatars hug
 * the centre "vs" and the names stay on the outside.
 */
function Team({
  players,
  meId,
  picked,
  t,
  align = "left",
}: {
  players: RoundPlayer[];
  meId?: string;
  picked: string[];
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
              p.id === meId
                ? "font-bold text-[var(--accent)]"
                : picked.includes(p.id)
                  ? "font-semibold"
                  : ""
            }`}
          >
            {p.id === meId ? t("common.you") : p.username}
          </span>
        </div>
      ))}
    </div>
  );
}

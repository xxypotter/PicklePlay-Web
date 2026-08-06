"use client";

import { useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { addPlayerAction, removePlayerAction } from "@/lib/sessions/actions";

export interface RosterRow {
  playerId: string;
  username: string;
  waitlistPos: number | null;
}

/**
 * Roster editing, alongside the rest of the details.
 *
 * Adding and removing people used to live only on the play console, which is
 * the screen you open on the night. Changing who's coming is a *before* the
 * night job, so it belongs next to the date and the courts — the organizer
 * shouldn't have to walk into the run-the-session screen to drop someone who
 * cancelled on Tuesday.
 *
 * Dropping a confirmed player promotes the first person waiting, which the
 * server action already handles; this only has to ask for it.
 */
export default function RosterEditor({
  sessionId,
  playing,
  waiting,
  candidates,
  maxPlayers,
}: {
  sessionId: string;
  playing: RosterRow[];
  waiting: RosterRow[];
  candidates: { id: string; username: string }[];
  maxPlayers: number;
}) {
  const t = useT();
  const [pending, start] = useTransition();

  const remove = (playerId: string) =>
    start(() => void removePlayerAction(sessionId, playerId));
  const add = (playerId: string) => start(() => void addPlayerAction(sessionId, playerId));

  const full = playing.length >= maxPlayers;

  return (
    <section className="card mt-4">
      <h2 className="text-sm font-medium text-[var(--muted)]">
        {t("form.whosPlaying", { count: playing.length, max: maxPlayers })}
      </h2>

      {playing.length === 0 ? (
        <p className="hint">{t("roster.empty")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {playing.map((p) => (
            <li
              key={p.playerId}
              className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {p.username}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(p.playerId)}
                aria-label={t("roster.removeLabel", { name: p.username })}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--danger)]
                  disabled:opacity-40"
              >
                {t("roster.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {waiting.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-medium text-[var(--muted)]">
            {t("session.waitlist", { count: waiting.length })}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {waiting.map((p) => (
              <li
                key={p.playerId}
                className="flex items-center gap-2 rounded-xl border border-dashed
                  border-[var(--border)] px-3 py-2.5"
              >
                <span className="w-5 shrink-0 text-sm text-[var(--muted)] tabular-nums">
                  {p.waitlistPos}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{p.username}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(p.playerId)}
                  aria-label={t("roster.removeLabel", { name: p.username })}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--danger)]
                    disabled:opacity-40"
                >
                  {t("roster.remove")}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {candidates.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
            {t("roster.add", { count: candidates.length })}
          </summary>
          {/* Past capacity people still get added — as waitlist, not as a refusal. */}
          {full ? (
            <p className="hint">{t("roster.fullNote")}</p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={pending}
                onClick={() => add(c.id)}
                className="truncate rounded-xl border border-[var(--border)] px-3 py-2.5
                  text-left text-sm disabled:opacity-50"
              >
                + {c.username}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

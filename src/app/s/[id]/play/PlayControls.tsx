"use client";

import { useState, useTransition } from "react";
import {
  addPlayerAction,
  removePlayerAction,
  setAttendanceAction,
  setSessionStatusAction,
} from "@/lib/sessions/actions";
import {
  deleteSessionAction,
  discardRoundAction,
  generateAllRoundsAction,
  generateRoundAction,
  reopenSessionAction,
  startSessionAction,
} from "@/lib/sessions/play-actions";

export function GenerateRoundButton({
  sessionId,
  attendingCount,
  courtCount,
  roundsSoFar,
}: {
  sessionId: string;
  attendingCount: number;
  courtCount: number;
  roundsSoFar: number;
}) {
  const [pending, start] = useTransition();
  const tooFew = attendingCount < 4;

  // A sensible night: enough rounds that everyone gets a good number of games
  // without the organizer doing arithmetic. They can change it.
  const seats = Math.min(courtCount, Math.floor(attendingCount / 4)) * 4;
  const suggested = Math.max(3, Math.min(12, Math.round((attendingCount / Math.max(1, seats)) * 6)));

  // Text, not a number: coercing every keystroke made the box impossible to
  // clear and retype.
  const [roundsText, setRoundsText] = useState(String(suggested));
  const rounds = Number.parseInt(roundsText, 10);
  const roundsValid = Number.isInteger(rounds) && rounds >= 1 && rounds <= 20;

  const gamesEach =
    seats > 0 && roundsValid ? ((rounds * seats) / attendingCount).toFixed(1) : null;

  if (tooFew) {
    return (
      <p className="hint mt-4">Mark at least 4 players present to build the matches.</p>
    );
  }

  if (roundsSoFar === 0) {
    return (
      <div className="mt-4">
        <label className="label" htmlFor="roundCount">
          How many rounds?
        </label>
        <div className="flex items-center gap-3">
          <input
            id="roundCount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={roundsText}
            onChange={(e) => setRoundsText(e.target.value.replace(/\D/g, "").slice(0, 2))}
            className="field w-24"
          />
          <button
            type="button"
            disabled={pending || !roundsValid}
            onClick={() => start(() => void generateAllRoundsAction(sessionId, rounds))}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {pending ? "Building…" : "Create all matches"}
          </button>
        </div>
        <p className={`hint ${roundsValid ? "" : "text-[var(--danger)]"}`}>
          {roundsValid
            ? `About ${gamesEach} games each. You can add more rounds later.`
            : "Enter a number of rounds between 1 and 20."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => void generateRoundAction(sessionId))}
        className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold
          disabled:opacity-50"
      >
        {pending ? "Building…" : "Add another round"}
      </button>
    </div>
  );
}

export function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);

  // Two taps rather than a confirm() dialog: this destroys the night's matches
  // and moves everyone's rating back, so it shouldn't be a single stray tap.
  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => (armed ? start(() => void deleteSessionAction(sessionId)) : setArmed(true))}
        className={`w-full rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-50 ${
          armed
            ? "bg-[var(--danger)] text-white"
            : "border border-[var(--border)] text-[var(--muted)]"
        }`}
      >
        {pending ? "Deleting…" : armed ? "Tap again to delete permanently" : "Delete session"}
      </button>
      {armed ? (
        <p className="hint text-center">
          Removes every match here and puts ratings back where they were.
        </p>
      ) : null}
    </div>
  );
}

export function DiscardRoundButton({
  sessionId,
  roundId,
}: {
  sessionId: string;
  roundId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => void discardRoundAction(sessionId, roundId))}
      className="text-xs font-semibold text-[var(--muted)] underline disabled:opacity-50"
    >
      {pending ? "…" : "Regenerate"}
    </button>
  );
}

export function AttendanceToggle({
  sessionId,
  playerId,
  username,
  attended,
}: {
  sessionId: string;
  playerId: string;
  username: string;
  attended: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => void setAttendanceAction(sessionId, playerId, !attended))}
      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left
        text-sm transition disabled:opacity-50 ${
          attended
            ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium"
            : "border-[var(--border)] text-[var(--muted)] line-through"
        }`}
    >
      <span className="truncate">{username}</span>
      <span className="shrink-0 text-xs">{attended ? "here" : "out"}</span>
    </button>
  );
}

export function AddPlayers({
  sessionId,
  candidates,
}: {
  sessionId: string;
  candidates: { id: string; username: string }[];
}) {
  const [pending, start] = useTransition();
  if (candidates.length === 0) return null;

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
        Add someone who didn&apos;t sign up ({candidates.length})
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={pending}
            onClick={() => start(() => void addPlayerAction(sessionId, c.id))}
            className="truncate rounded-xl border border-[var(--border)] px-3 py-2.5 text-left
              text-sm disabled:opacity-50"
          >
            + {c.username}
          </button>
        ))}
      </div>
    </details>
  );
}

export function RemovePlayerButton({
  sessionId,
  playerId,
}: {
  sessionId: string;
  playerId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => void removePlayerAction(sessionId, playerId))}
      aria-label="Remove from session"
      className="shrink-0 px-1 text-xs text-[var(--muted)] disabled:opacity-50"
    >
      ✕
    </button>
  );
}

/**
 * The line between setup and play.
 *
 * Before it, details can be edited and no matches exist. After it, the session
 * shows as Playing and its details are locked, so the schedule can't end up
 * describing courts or a format that have since changed underneath it.
 */
export function StartSessionButton({
  sessionId,
  attendingCount,
}: {
  sessionId: string;
  attendingCount: number;
}) {
  const [pending, start] = useTransition();
  const tooFew = attendingCount < 4;

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending || tooFew}
        onClick={() => start(() => void startSessionAction(sessionId))}
        className="btn-primary disabled:opacity-40"
      >
        {pending ? "Starting…" : "Start session"}
      </button>
      <p className="hint">
        {tooFew
          ? "Mark at least 4 players present to start."
          : "Locks the details and lets you build the matches. You can undo this until the first round exists."}
      </p>
    </div>
  );
}

export function ReopenSessionButton({ sessionId }: { sessionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              await reopenSessionAction(sessionId);
              setError(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't reopen.");
            }
          })
        }
        className="btn-ghost text-sm text-[var(--muted)]"
      >
        {pending ? "…" : "Back to setup"}
      </button>
      {error ? (
        <p role="alert" className="hint text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function CloseSessionButton({ sessionId }: { sessionId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => void setSessionStatusAction(sessionId, "closed"))}
      className="mt-8 w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm
        font-medium text-[var(--muted)] disabled:opacity-50"
    >
      {pending ? "…" : "Close this session"}
    </button>
  );
}

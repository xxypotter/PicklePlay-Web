"use client";

import { useState, useTransition } from "react";
import {
  planCasualRounds,
  planRegularRounds,
  seatsFor,
  splitsEvenly,
} from "@/lib/matchmaking/plan";
import {
  addPlayerAction,
  removePlayerAction,
  setAttendanceAction,
} from "@/lib/sessions/actions";
import {
  deleteSessionAction,
  discardRoundAction,
  endSessionAction,
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
  format,
}: {
  sessionId: string;
  attendingCount: number;
  courtCount: number;
  roundsSoFar: number;
  format: string;
}) {
  const [pending, start] = useTransition();
  const tooFew = attendingCount < 4;

  // A round robin has an exact right length; other formats get a rule of
  // thumb. Either way the organizer can override it.
  const seats = seatsFor(attendingCount, courtCount);
  const plan = format === "regular" ? planRegularRounds(attendingCount, courtCount) : null;
  const suggested = plan?.rounds ?? planCasualRounds(attendingCount, courtCount);

  // Text, not a number: coercing every keystroke made the box impossible to
  // clear and retype.
  const [roundsText, setRoundsText] = useState(String(suggested));
  const rounds = Number.parseInt(roundsText, 10);
  const roundsValid = Number.isInteger(rounds) && rounds >= 1 && rounds <= 20;

  const gamesEach = seats > 0 && roundsValid ? (rounds * seats) / attendingCount : null;
  const byesEach = gamesEach === null ? 0 : rounds - gamesEach;
  // Flag this before the night rather than after. An uneven split is
  // arithmetic — no amount of clever scheduling rescues it.
  const uneven =
    roundsValid && seats > 0 && !splitsEvenly(attendingCount, courtCount, rounds);

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
        <p
          className={`hint ${
            !roundsValid ? "text-[var(--danger)]" : uneven ? "text-[var(--accent)]" : ""
          }`}
        >
          {!roundsValid ? (
            "Enter a number of rounds between 1 and 20."
          ) : uneven ? (
            <>
              {rounds} rounds doesn&apos;t divide evenly across {attendingCount} players —{" "}
              {Math.ceil(gamesEach!)} games for some, {Math.floor(gamesEach!)} for the rest.
              {plan ? ` Use ${plan.rounds} to give everyone the same.` : ""}
            </>
          ) : (
            <>
              {gamesEach} games each
              {byesEach > 0 ? `, sitting out ${byesEach}` : ""}
              {plan && rounds === plan.rounds && plan.fullCoverage
                ? " — and you partner everyone exactly once."
                : ". You can add more rounds later."}
            </>
          )}
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

/**
 * Ending is the last thing that happens, and it can't be undone from the UI —
 * so it asks, and it says what's about to be lost. Unscored matches are the
 * thing people actually forget: a court finishes, nobody taps the score in, and
 * ending the session strands the result.
 */
export function EndSessionButton({
  sessionId,
  unscored,
  className = "mt-8",
}: {
  sessionId: string;
  unscored: number;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={`btn-accent ${className}`}
      >
        End session
      </button>
    );
  }

  return (
    <div className={`card ${className}`}>
      <p className="font-semibold">End this session?</p>
      {unscored > 0 ? (
        <p className="mt-1 text-sm font-medium text-[var(--danger)]">
          {unscored} match{unscored === 1 ? " has" : "es have"} no score yet. Ending now
          leaves {unscored === 1 ? "it" : "them"}{" "}
          unrecorded and out of everyone&apos;s rating.
        </p>
      ) : (
        <p className="hint">
          Every match is scored. Results and ratings stay exactly as they are.
        </p>
      )}
      <p className="hint">No more scores can be entered afterwards.</p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => setArmed(false)}
          className="btn-ghost flex-1"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => void endSessionAction(sessionId))}
          className="flex-1 rounded-full bg-[var(--danger)] px-4 py-3 text-base font-semibold
            text-white disabled:opacity-50"
        >
          {pending ? "Ending…" : "End it"}
        </button>
      </div>
    </div>
  );
}

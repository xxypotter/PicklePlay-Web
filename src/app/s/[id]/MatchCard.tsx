"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/lib/auth/types";
import { saveScoreAction, voidMatchAction } from "@/lib/sessions/play-actions";

export interface MatchCardData {
  id: string;
  courtLabel: string;
  teamA: { id: string; username: string }[];
  teamB: { id: string; username: string }[];
  scoreA: number | null;
  scoreB: number | null;
  completed: boolean;
}

/**
 * Functional updater, not `value + 1`.
 *
 * React batches state updates, so several taps inside one frame would all read
 * the same stale value and collapse into a single increment — exactly what
 * happens when someone taps out an 11-point game.
 */
const step = (delta: number) => (current: number) =>
  Math.max(0, Math.min(99, current + delta));

export default function MatchCard({
  match,
  meId,
  canEnterScore,
  canVoid = false,
  highlight = false,
}: {
  match: MatchCardData;
  meId?: string;
  canEnterScore: boolean;
  canVoid?: boolean;
  highlight?: boolean;
}) {
  const [state, action, pending] = useActionState(saveScoreAction, {} as FormState);
  const [voiding, startVoid] = useTransition();
  const [a, setA] = useState(match.scoreA ?? 0);
  const [b, setB] = useState(match.scoreB ?? 0);

  const mine = (team: { id: string }[]) => team.some((p) => p.id === meId);
  const label = (team: { id: string; username: string }[]) =>
    team.map((p) => (p.id === meId ? "You" : p.username)).join(" & ");

  // Read-only rows for anyone not in the match: seeing the court is the point,
  // editing it isn't.
  if (!canEnterScore) {
    return (
      <div
        className={`card ${highlight ? "border-[var(--accent)]" : ""}`}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">{match.courtLabel}</h3>
          {match.completed ? (
            <span className="font-mono text-sm tabular-nums">
              {match.scoreA}–{match.scoreB}
            </span>
          ) : (
            <span className="text-xs text-[var(--muted)]">In play</span>
          )}
        </div>
        <p className={`mt-1.5 text-sm ${mine(match.teamA) ? "font-semibold" : ""}`}>
          {label(match.teamA)}
        </p>
        <p className={`text-sm ${mine(match.teamB) ? "font-semibold" : ""}`}>
          {label(match.teamB)}
        </p>
      </div>
    );
  }

  return (
    <form
      action={action}
      className={`card ${highlight ? "border-2 border-[var(--accent)]" : ""}`}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-bold">{match.courtLabel}</h3>
        {match.completed ? (
          <span className="text-xs font-semibold text-[var(--accent)]">Recorded</span>
        ) : null}
      </div>

      <input type="hidden" name="matchId" value={match.id} />
      <input type="hidden" name="scoreA" value={a} />
      <input type="hidden" name="scoreB" value={b} />

      {/*
        Your own team always renders on top, whichever side of the court you're
        on. Entering your score first is the natural motion, and a fixed A/B
        order is how people put the numbers in the wrong rows.
      */}
      <div className="mt-3 flex flex-col gap-3">
        {(mine(match.teamB)
          ? ([
              ["B", label(match.teamB), b, setB],
              ["A", label(match.teamA), a, setA],
            ] as const)
          : ([
              ["A", label(match.teamA), a, setA],
              ["B", label(match.teamB), b, setB],
            ] as const)
        ).map(([side, text, value, setter]) => (
          <Side
            key={side}
            label={text}
            value={value}
            onStep={(d) => setter(step(d))}
            highlight={
              (side === "A" && mine(match.teamA)) || (side === "B" && mine(match.teamB))
            }
          />
        ))}
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || a === b}
        className="btn-primary mt-4 disabled:opacity-40"
      >
        {pending ? "Saving…" : match.completed ? "Update score" : "Save score"}
      </button>
      {/* Only once someone has actually scored — 0–0 is a fresh card, not a tie. */}
      {a === b && a > 0 ? (
        <p className="hint text-center">Pickleball has no ties.</p>
      ) : null}

      {/*
        Voiding is kept out of the player-facing card and off unplayed matches:
        it's for an admin undoing a wrong result, not a way to delete a loss.
        The match is marked void rather than deleted, so history stays auditable.
      */}
      {canVoid && match.completed ? (
        <button
          type="button"
          disabled={voiding}
          onClick={() => startVoid(() => void voidMatchAction(match.id))}
          className="mt-3 w-full text-xs font-semibold text-[var(--muted)] underline
            disabled:opacity-50"
        >
          {voiding ? "Voiding…" : "Void this match"}
        </button>
      ) : null}
    </form>
  );
}

function Side({
  label,
  value,
  onStep,
  highlight = false,
}: {
  label: string;
  value: number;
  onStep: (delta: number) => void;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          highlight ? "font-bold" : "font-medium text-[var(--muted)]"
        }`}
      >
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Step label="−" onClick={() => onStep(-1)} />
        <span className="w-9 text-center font-mono text-2xl font-bold tabular-nums">{value}</span>
        <Step label="+" onClick={() => onStep(1)} />
      </div>
    </div>
  );
}

function Step({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="size-11 rounded-xl border border-[var(--border)] text-xl font-semibold
        active:bg-[var(--accent)]/10"
    >
      {label}
    </button>
  );
}

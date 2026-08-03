"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/lib/auth/types";
import { saveScoreAction } from "@/lib/sessions/play-actions";

export interface CourtMatch {
  id: string;
  courtNo: number | null;
  teamA: string[];
  teamB: string[];
  scoreA: number | null;
  scoreB: number | null;
  completed: boolean;
}

export default function ScoreEntry({ match }: { match: CourtMatch }) {
  const [state, action, pending] = useActionState(saveScoreAction, {} as FormState);
  const [a, setA] = useState(match.scoreA ?? 0);
  const [b, setB] = useState(match.scoreB ?? 0);

  return (
    <form action={action} className="card">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-[var(--muted)]">Court {match.courtNo}</h3>
        {match.completed ? (
          <span className="text-xs font-semibold text-[var(--accent)]">Recorded</span>
        ) : null}
      </div>

      <input type="hidden" name="matchId" value={match.id} />
      <input type="hidden" name="scoreA" value={a} />
      <input type="hidden" name="scoreB" value={b} />

      <div className="mt-3 flex flex-col gap-3">
        <Side names={match.teamA} value={a} onStep={(d) => setA(step(d))} />
        <Side names={match.teamB} value={b} onStep={(d) => setB(step(d))} />
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
    </form>
  );
}

/**
 * Functional updater, not `value + 1`.
 *
 * React batches state updates, so several taps inside one frame would all read
 * the same stale `value` and collapse into a single increment — which is
 * exactly what happens when someone taps quickly to log an 11-point game.
 */
const step = (delta: number) => (current: number) =>
  Math.max(0, Math.min(99, current + delta));

/**
 * One team's row. Big steppers rather than a keyboard: this gets used standing
 * on a court, one-handed, often in the sun.
 */
function Side({
  names,
  value,
  onStep,
}: {
  names: string[];
  value: number;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{names.join(" & ")}</span>
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

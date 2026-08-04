"use client";

import { useActionState, useState, useTransition } from "react";
import Avatar from "@/components/Avatar";
import type { FormState } from "@/lib/auth/types";
import type { RoundPlayer } from "@/lib/sessions/queries";
import { saveScoreAction, voidMatchAction } from "@/lib/sessions/play-actions";

export interface MatchCardData {
  id: string;
  courtLabel: string;
  teamA: RoundPlayer[];
  teamB: RoundPlayer[];
  scoreA: number | null;
  scoreB: number | null;
  completed: boolean;
}

const MAX_SCORE = 99;

/**
 * Scores are held as text, not numbers.
 *
 * Coercing on every keystroke makes the box impossible to clear and retype —
 * you end up typing "1" onto a stubborn "0" and getting "01". Text in, parsed
 * once at the edges.
 */
const clampText = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 2);
  return digits === "" ? "" : String(Math.min(MAX_SCORE, Number(digits)));
};

const stepFrom = (current: string, delta: number) =>
  String(Math.max(0, Math.min(MAX_SCORE, (Number.parseInt(current, 10) || 0) + delta)));

/** Always interactive — read-only matches render as compact rows in Schedule. */
export default function MatchCard({
  match,
  meId,
  canVoid = false,
  highlight = false,
}: {
  match: MatchCardData;
  meId?: string;
  canVoid?: boolean;
  highlight?: boolean;
}) {
  const [state, action, pending] = useActionState(saveScoreAction, {} as FormState);
  const [voiding, startVoid] = useTransition();
  const [a, setA] = useState(String(match.scoreA ?? 0));
  const [b, setB] = useState(String(match.scoreB ?? 0));

  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  const bothEntered = Number.isInteger(na) && Number.isInteger(nb);
  const tied = bothEntered && na === nb;

  const mine = (team: RoundPlayer[]) => team.some((p) => p.id === meId);

  // Your own team renders on top whichever side of the court you're on. A fixed
  // A/B order is how people put the numbers in the wrong row.
  const sides = mine(match.teamB)
    ? ([
        { key: "B", players: match.teamB, value: b, set: setB },
        { key: "A", players: match.teamA, value: a, set: setA },
      ] as const)
    : ([
        { key: "A", players: match.teamA, value: a, set: setA },
        { key: "B", players: match.teamB, value: b, set: setB },
      ] as const);

  return (
    <form action={action} className={`card ${highlight ? "border-2 border-[var(--accent)]" : ""}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-bold">{match.courtLabel}</h3>
        {match.completed ? (
          <span className="text-xs font-semibold text-[var(--accent)]">Recorded</span>
        ) : null}
      </div>

      <input type="hidden" name="matchId" value={match.id} />
      <input type="hidden" name="scoreA" value={a} />
      <input type="hidden" name="scoreB" value={b} />

      <div className="mt-3 flex flex-col gap-3">
        {sides.map((side) => (
          <Side
            key={side.key}
            players={side.players}
            meId={meId}
            value={side.value}
            onChange={(v) => side.set(clampText(v))}
            onStep={(d) => side.set((prev) => stepFrom(prev, d))}
            highlight={mine(side.players)}
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
        disabled={pending || !bothEntered || tied}
        className="btn-primary mt-4 disabled:opacity-40"
      >
        {pending ? "Saving…" : match.completed ? "Update score" : "Save score"}
      </button>

      {/* Only once someone has actually scored — 0–0 is a fresh card, not a tie. */}
      {tied && na > 0 ? (
        <p className="hint text-center">Pickleball has no ties.</p>
      ) : !bothEntered ? (
        <p className="hint text-center">Enter both scores.</p>
      ) : null}

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
  players,
  meId,
  value,
  onChange,
  onStep,
  highlight,
}: {
  players: RoundPlayer[];
  meId?: string;
  value: string;
  onChange: (value: string) => void;
  onStep: (delta: number) => void;
  highlight: boolean;
}) {
  const label = players.map((p) => (p.id === meId ? "You" : p.username)).join(" & ");

  return (
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="flex shrink-0">
          {players.map((p, i) => (
            <span key={p.id} className={i > 0 ? "-ml-2" : ""}>
              <Avatar
                username={p.username}
                avatar={p.avatar}
                size={24}
                className="ring-2 ring-[var(--surface)]"
              />
            </span>
          ))}
        </span>
        <span
          className={`truncate text-sm ${
            highlight ? "font-bold" : "font-medium text-[var(--muted)]"
          }`}
        >
          {label}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Step label="−" onClick={() => onStep(-1)} />
        {/* Tappable and typeable: eleven taps to record an 11 is absurd. */}
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Score for ${label}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="w-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2
            text-center font-mono text-xl font-bold tabular-nums outline-none
            focus:border-[var(--accent)]"
        />
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
      aria-label={label === "+" ? "Increase" : "Decrease"}
      className="size-11 shrink-0 rounded-xl border border-[var(--border)] text-xl font-semibold
        active:bg-[var(--accent-soft)]"
    >
      {label}
    </button>
  );
}

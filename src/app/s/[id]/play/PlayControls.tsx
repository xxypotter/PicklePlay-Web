"use client";

import { useTransition } from "react";
import {
  addPlayerAction,
  removePlayerAction,
  setAttendanceAction,
  setSessionStatusAction,
} from "@/lib/sessions/actions";
import { discardRoundAction, generateRoundAction } from "@/lib/sessions/play-actions";

export function GenerateRoundButton({
  sessionId,
  attendingCount,
  hasOpenRound,
}: {
  sessionId: string;
  attendingCount: number;
  hasOpenRound: boolean;
}) {
  const [pending, start] = useTransition();
  const tooFew = attendingCount < 4;

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending || tooFew}
        onClick={() => start(() => void generateRoundAction(sessionId))}
        className="btn-primary disabled:opacity-40"
      >
        {pending ? "Building…" : hasOpenRound ? "Generate next round" : "Generate round 1"}
      </button>
      {tooFew ? (
        <p className="hint">Mark at least 4 players present to build a round.</p>
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

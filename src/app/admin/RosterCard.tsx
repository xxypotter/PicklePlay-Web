"use client";

import { useActionState, useTransition } from "react";
import { ROLE_LABELS, type FormState, type Role } from "@/lib/auth/types";
import { adjustRatingAction, recomputeAction, setRoleAction } from "./actions";

export interface RosterEntry {
  id: string;
  username: string;
  role: Role;
  rating: number | null;
  reliability: number | null;
  provisional: boolean | null;
  selfDeclared: boolean | null;
  localMatches: number | null;
}

export default function RosterCard({
  roster,
  canManageRoles,
  meId,
}: {
  roster: RosterEntry[];
  canManageRoles: boolean;
  meId: string;
}) {
  const [roleState, roleAction, rolePending] = useActionState(setRoleAction, {} as FormState);
  const [adjustState, adjustAction, adjustPending] = useActionState(
    adjustRatingAction,
    {} as FormState,
  );
  const [recomputing, startRecompute] = useTransition();

  return (
    <section className="card mt-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-[var(--muted)]">Players ({roster.length})</h2>
        <button
          type="button"
          onClick={() => startRecompute(() => void recomputeAction())}
          disabled={recomputing}
          className="text-xs font-semibold text-[var(--accent)] underline disabled:opacity-50"
        >
          {recomputing ? "Recomputing…" : "Recompute ratings"}
        </button>
      </div>

      {roleState.error || adjustState.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {roleState.error ?? adjustState.error}
        </p>
      ) : null}

      <ul className="mt-2 divide-y divide-[var(--border)]">
        {roster.map((p) => {
          const isMe = p.id === meId;
          const roleLocked = p.role === "superadmin" || isMe;

          return (
            <li key={p.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.username}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {ROLE_LABELS[p.role]}
                    {isMe ? " · you" : ""}
                    {p.localMatches !== null ? ` · ${p.localMatches} matches` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm tabular-nums">
                    {p.rating === null ? "—" : p.rating.toFixed(3)}
                    {p.provisional ? "?" : ""}
                  </span>
                  {canManageRoles && !roleLocked ? (
                    <form action={roleAction}>
                      <input type="hidden" name="playerId" value={p.id} />
                      <input
                        type="hidden"
                        name="role"
                        value={p.role === "admin" ? "player" : "admin"}
                      />
                      <button
                        type="submit"
                        disabled={rolePending}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs
                          font-semibold disabled:opacity-50"
                      >
                        {p.role === "admin" ? "− admin" : "+ admin"}
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--accent)]">
                  Adjust rating
                </summary>
                <form action={adjustAction} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="playerId" value={p.id} />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-[var(--muted)]">
                      Rating
                      <input
                        name="rating"
                        className="field mt-1 py-2 text-sm"
                        type="number"
                        step="0.001"
                        min={2}
                        max={8}
                        defaultValue={p.rating?.toFixed(3) ?? "3.500"}
                        required
                      />
                    </label>
                    <label className="text-xs text-[var(--muted)]">
                      Reliability %
                      <input
                        name="reliability"
                        className="field mt-1 py-2 text-sm"
                        type="number"
                        step="1"
                        min={0}
                        max={100}
                        defaultValue={Math.round((p.reliability ?? 0) * 100)}
                        required
                      />
                    </label>
                  </div>
                  <input
                    name="note"
                    className="field py-2 text-sm"
                    placeholder="Why? (optional, kept in the log)"
                    maxLength={120}
                  />
                  <button
                    type="submit"
                    disabled={adjustPending}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold
                      disabled:opacity-50"
                  >
                    {adjustPending ? "Saving…" : "Override rating"}
                  </button>
                  <p className="text-xs text-[var(--muted)]">
                    Recorded as a dated correction in their history, not a silent edit.
                    Ratings recompute immediately.
                  </p>
                </form>
              </details>
            </li>
          );
        })}
      </ul>

      {canManageRoles ? (
        <p className="hint mt-4">
          Admins create sessions, run matchups, and share the invite code. Only you can
          grant or remove admin.
        </p>
      ) : null}
    </section>
  );
}

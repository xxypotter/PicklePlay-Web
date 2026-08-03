"use client";

import { useActionState } from "react";
import { ROLE_LABELS, type FormState, type Role } from "@/lib/auth/types";
import { setRoleAction } from "./actions";

export interface RosterEntry {
  id: string;
  username: string;
  role: Role;
}

export default function RosterCard({
  roster,
  canManage,
  meId,
}: {
  roster: RosterEntry[];
  canManage: boolean;
  meId: string;
}) {
  const [state, action, pending] = useActionState(setRoleAction, {} as FormState);

  return (
    <section className="card mt-5">
      <h2 className="text-sm font-medium text-[var(--muted)]">Players ({roster.length})</h2>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <ul className="mt-3 divide-y divide-[var(--border)]">
        {roster.map((p) => {
          const isMe = p.id === meId;
          const locked = p.role === "superadmin" || isMe;

          return (
            <li key={p.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{p.username}</p>
                <p className="text-xs text-[var(--muted)]">
                  {ROLE_LABELS[p.role]}
                  {isMe ? " · you" : ""}
                </p>
              </div>

              {canManage && !locked ? (
                <form action={action}>
                  <input type="hidden" name="playerId" value={p.id} />
                  <input
                    type="hidden"
                    name="role"
                    value={p.role === "admin" ? "player" : "admin"}
                  />
                  <button
                    type="submit"
                    disabled={pending}
                    className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-xs
                      font-semibold disabled:opacity-50"
                  >
                    {p.role === "admin" ? "Remove admin" : "Make admin"}
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canManage ? (
        <p className="hint mt-4">
          Admins can create sessions, run matchups, and share the invite code. Only you
          can grant or remove admin.
        </p>
      ) : null}
    </section>
  );
}

"use client";

import { useActionState, useState, useTransition } from "react";
import type { RecomputeSummary } from "@/lib/rating/service";
import { ROLE_LABELS, type FormState, type Role } from "@/lib/auth/types";
import { clearImportedRecordAction } from "@/lib/profile/actions";
import { adjustRatingAction, recomputeAction, resetPinAction, setRoleAction } from "./actions";

export interface RosterEntry {
  id: string;
  username: string;
  role: Role;
  rating: number | null;
  reliability: number | null;
  provisional: boolean | null;
  selfDeclared: boolean | null;
  localMatches: number | null;
  importedMatches: number;
  importedWins: number;
}

export default function RosterCard({
  roster,
  canManageRoles,
  canRecompute,
  meRole,
  meId,
}: {
  roster: RosterEntry[];
  canManageRoles: boolean;
  /** Rebuilding every rating at once is the owner's call. */
  canRecompute: boolean;
  meRole: Role;
  meId: string;
}) {
  /** Mirrors resetPinAction's rule; the server is what actually enforces it. */
  const canResetPin = (role: Role) =>
    role !== "superadmin" && (role !== "admin" || meRole === "superadmin");
  /*
   * Mirrors canAdjustRating. An admin may correct a player, and themselves —
   * not a peer, and not the owner. Hiding it is a courtesy; adjustRatingAction
   * is what actually refuses.
   */
  const canAdjust = (p: RosterEntry) =>
    meRole === "superadmin" || p.id === meId || p.role === "player";
  const [roleState, roleAction, rolePending] = useActionState(setRoleAction, {} as FormState);
  const [adjustState, adjustAction, adjustPending] = useActionState(
    adjustRatingAction,
    {} as FormState,
  );
  const [pinState, pinAction, pinPending] = useActionState(resetPinAction, {} as FormState);
  const [recomputing, startRecompute] = useTransition();
  const [recomputed, setRecomputed] = useState<RecomputeSummary | null>(null);
  const [clearing, startClear] = useTransition();

  return (
    <section className="card mt-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-[var(--muted)]">Players ({roster.length})</h2>
        {canRecompute ? (
          <button
            type="button"
            onClick={() =>
              startRecompute(async () => {
                const summary = await recomputeAction();
                setRecomputed(summary);
              })
            }
            disabled={recomputing}
            className="text-xs font-semibold text-[var(--accent)] underline disabled:opacity-50"
          >
            {recomputing ? "Recomputing…" : "Recompute ratings"}
          </button>
        ) : null}
      </div>

      {/*
        Both halves belong to whoever has the button. Explaining a control that
        isn't there just raises a question the reader can't act on.

        The explanation earns its place for the person who does have it: the
        recompute finishes in well under a second and the numbers usually don't
        move, so without a word it looks like it did nothing.
      */}
      {canRecompute ? (
        recomputed ? (
          <p className="mt-2 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs">
            Rebuilt <strong>{recomputed.players}</strong> player
            {recomputed.players === 1 ? "" : "s"} from{" "}
            <strong>{recomputed.matches}</strong> match
            {recomputed.matches === 1 ? "" : "es"} and{" "}
            <strong>{recomputed.seeds}</strong> starting rating
            {recomputed.seeds === 1 ? "" : "s"}. Numbers not moving means they were
            already right.
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Ratings rebuild themselves after every score, edit, void or deletion,
            so you rarely need this. Press it if a rating looks out of date, or
            after anyone is added outside the app. It only recalculates — it never
            changes a match result, and it can&apos;t lose anything.
          </p>
        )
      ) : null}

      {roleState.error || adjustState.error || pinState.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {roleState.error ?? adjustState.error ?? pinState.error}
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

              {canAdjust(p) ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--accent)]">
                  Adjust rating
                </summary>
                <form action={adjustAction} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="playerId" value={p.id} />
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
                    Sets where their rating sits — win/loss comes from real matches and
                    can&apos;t be typed in. Reliability is earned by playing, so it
                    isn&apos;t settable. Recorded as a dated correction in their history,
                    not a silent edit.
                  </p>
                </form>
              </details>
              ) : null}

              {/*
                Clearing, not editing. The super admin can wipe an imported
                record so the player can enter it again — nobody can type a
                number *into* someone else's history, which is the property
                that keeps the record trustworthy.
              */}
              {canManageRoles && p.importedMatches > 0 ? (
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2">
                  <span className="text-xs text-[var(--muted)]">
                    Imported {p.importedWins}/{p.importedMatches} (
                    {Math.round((p.importedWins / p.importedMatches) * 100)}%)
                  </span>
                  <button
                    type="button"
                    disabled={clearing}
                    onClick={() => startClear(() => void clearImportedRecordAction(p.id))}
                    className="shrink-0 text-xs font-semibold text-[var(--danger)] underline
                      disabled:opacity-50"
                  >
                    {clearing ? "…" : "Clear"}
                  </button>
                </div>
              ) : null}

              {canResetPin(p.role) ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">
                    Reset PIN
                  </summary>
                  <form action={pinAction} className="mt-3 flex gap-2">
                    <input type="hidden" name="playerId" value={p.id} />
                    <input
                      name="pin"
                      className="field py-2 text-sm"
                      inputMode="numeric"
                      pattern="\d{4,6}"
                      placeholder="New 4–6 digit PIN"
                      required
                    />
                    <button
                      type="submit"
                      disabled={pinPending}
                      className="shrink-0 rounded-lg border border-[var(--border)] px-3 text-xs
                        font-semibold disabled:opacity-50"
                    >
                      Set
                    </button>
                  </form>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    Signs them out everywhere. Tell them the new PIN in person.
                  </p>
                </details>
              ) : null}
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

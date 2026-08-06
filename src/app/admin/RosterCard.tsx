"use client";

import { useActionState, useState, useTransition } from "react";
import type { RecomputeSummary } from "@/lib/rating/service";
import type { FormState, Role } from "@/lib/auth/types";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { useT } from "@/lib/i18n/client";
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
  const t = useT();
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
        <h2 className="text-sm font-medium text-[var(--muted)]">
          {t("admin.players", { count: roster.length })}
        </h2>
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
            {recomputing ? t("admin.recomputing") : t("admin.recompute")}
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
            {t("admin.recomputeDone", {
              players: recomputed.players,
              matches: recomputed.matches,
              seeds: recomputed.seeds,
            })}
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted)]">{t("admin.recomputeHint")}</p>
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
                    {t(`role.${p.role}` as DictKey)}
                    {isMe ? t("admin.you") : ""}
                    {p.localMatches !== null
                      ? t("admin.matchCount", { count: p.localMatches })
                      : ""}
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
                        {p.role === "admin" ? t("admin.removeAdmin") : t("admin.makeAdmin")}
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>

              {canAdjust(p) ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--accent)]">
                  {t("admin.adjustRating")}
                </summary>
                <form action={adjustAction} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="playerId" value={p.id} />
                  <label className="text-xs text-[var(--muted)]">
                    {t("admin.ratingLabel")}
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
                    {t("admin.reliabilityOptional")}
                    <input
                      name="reliability"
                      className="field mt-1 py-2 text-sm"
                      type="number"
                      step="1"
                      min={0}
                      max={100}
                      placeholder={t("admin.reliabilityPlaceholder")}
                    />
                  </label>
                  <input
                    name="note"
                    className="field py-2 text-sm"
                    placeholder={t("admin.whyOptional")}
                    maxLength={120}
                  />
                  <button
                    type="submit"
                    disabled={adjustPending}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold
                      disabled:opacity-50"
                  >
                    {adjustPending ? t("common.saving") : t("admin.overrideRating")}
                  </button>
                  <p className="text-xs text-[var(--muted)]">{t("admin.adjustNote")}</p>
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
                    {t("admin.importedLine", {
                      wins: p.importedWins,
                      matches: p.importedMatches,
                      rate: Math.round((p.importedWins / p.importedMatches) * 100),
                    })}
                  </span>
                  <button
                    type="button"
                    disabled={clearing}
                    onClick={() => startClear(() => void clearImportedRecordAction(p.id))}
                    className="shrink-0 text-xs font-semibold text-[var(--danger)] underline
                      disabled:opacity-50"
                  >
                    {clearing ? "…" : t("admin.clear")}
                  </button>
                </div>
              ) : null}

              {canResetPin(p.role) ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">
                    {t("admin.resetPin")}
                  </summary>
                  <form action={pinAction} className="mt-3 flex gap-2">
                    <input type="hidden" name="playerId" value={p.id} />
                    <input
                      name="pin"
                      className="field py-2 text-sm"
                      inputMode="numeric"
                      pattern="\d{4,6}"
                      placeholder={t("admin.newPinPlaceholder")}
                      required
                    />
                    <button
                      type="submit"
                      disabled={pinPending}
                      className="shrink-0 rounded-lg border border-[var(--border)] px-3 text-xs
                        font-semibold disabled:opacity-50"
                    >
                      {t("admin.setPin")}
                    </button>
                  </form>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    {t("admin.pinResetNote")}
                  </p>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canManageRoles ? (
        <p className="hint mt-4">{t("admin.roleNote")}</p>
      ) : null}
    </section>
  );
}

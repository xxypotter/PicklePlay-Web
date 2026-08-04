"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/auth/types";
import { reseedAction } from "@/lib/rating/reseed-actions";

export default function ReseedCard({
  currentRating,
  daysUntilAllowed,
}: {
  currentRating: number;
  daysUntilAllowed: number;
}) {
  const [state, action, pending] = useActionState(reseedAction, {} as FormState);
  const locked = daysUntilAllowed > 0;

  return (
    <section className="card mt-5">
      <h2 className="text-sm font-medium text-[var(--muted)]">Update from your real DUPR</h2>
      <p className="hint">
        Played elsewhere and your DUPR moved? Bring it across. Once every 30 days, and
        it&apos;s recorded publicly in your history below.
      </p>

      {locked ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          You can do this again in {daysUntilAllowed} day{daysUntilAllowed === 1 ? "" : "s"}.
        </p>
      ) : (
        <form action={action} className="mt-4 flex flex-col gap-3">
          <label className="text-xs text-[var(--muted)]">
            DUPR
            <input
              name="rating"
              className="field mt-1"
              type="number"
              step="0.001"
              min={2}
              max={8}
              defaultValue={currentRating.toFixed(3)}
              required
            />
          </label>

          {state.error ? (
            <p role="alert" className="text-sm font-medium text-[var(--danger)]">
              {state.error}
            </p>
          ) : null}

          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Updating…" : "Update my rating"}
          </button>
        </form>
      )}
    </section>
  );
}

"use client";

import { useCallback, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";

/**
 * Run a server action from a button and show what it said when it refused.
 *
 * Every action in this app explains its refusals — "pair every player who is
 * here", "score every game first", "need four players present" — and until
 * v2.0 almost none of those sentences reached anyone. A button that fired its
 * action and forgot the promise did nothing on a refusal; one that awaited it
 * inside a transition threw the whole page to the generic error screen. This
 * is the one place that catches, so the message lands next to the button.
 *
 * A redirect from an action is not a failure: Next signals it with a special
 * error, which has to pass through untouched or the navigation never happens.
 */
export function useServerAction() {
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (work: () => Promise<unknown>, after?: () => void) => {
      start(async () => {
        setError(null);
        try {
          await work();
          after?.();
        } catch (e) {
          if (isRedirect(e)) throw e;
          setError(e instanceof Error && e.message ? e.message : t("err.actionFailed"));
        }
      });
    },
    [t],
  );

  return { run, pending, error, clearError: () => setError(null) };
}

const isRedirect = (e: unknown) =>
  typeof e === "object" && e !== null && "digest" in e &&
  String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");

/** The refusal, under the control that caused it. Renders nothing when there is none. */
export function ActionError({ error, className = "" }: { error: string | null; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={`mt-2 text-sm font-medium text-[var(--danger)] ${className}`}>
      {error}
    </p>
  );
}

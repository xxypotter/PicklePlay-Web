"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Keep a page current when the data is being changed by somebody else.
 *
 * Server actions revalidate, so your *own* edits appear immediately. What
 * doesn't is everyone else's: on a session night one person usually enters
 * every score, and the eight people watching Standings on their own phones see
 * a page frozen at whenever they opened it. Nothing on the page tells them it
 * is stale, which is worse than showing nothing.
 *
 * Two triggers, cheapest first:
 *
 * - **Coming back to the app.** The common case on a phone — you put it in your
 *   pocket between games and pick it up expecting current numbers. Costs one
 *   request per return, only when something might have changed.
 * - **A slow poll**, on while the caller says the session is live. Off the rest
 *   of the time, because a finished session's standings never move again and a
 *   page nobody is looking at should not be asking.
 *
 * `router.refresh()` re-runs the server components and reconciles in place, so
 * scroll position, the tab you're on and a half-typed score all survive. That
 * is the difference between this and a reload, and it is why this is safe to
 * run underneath someone entering a result.
 */
export default function LiveRefresh({
  /** Poll only while this is true — pass `status === "live"`. */
  active = false,
  /** Milliseconds between polls. Long on purpose. */
  intervalMs = 20_000,
}: {
  active?: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  // Refreshing while the previous one is still in flight just queues work.
  const busy = useRef(false);

  useEffect(() => {
    const refresh = () => {
      if (busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      router.refresh();
      // No completion signal to await; a short guard is enough to stop a
      // visibility change and a poll tick firing on top of each other.
      window.setTimeout(() => {
        busy.current = false;
      }, 1_000);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    const timer = active ? window.setInterval(refresh, intervalMs) : undefined;

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [router, active, intervalMs]);

  return null;
}

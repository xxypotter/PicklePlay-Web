"use client";

import { useSyncExternalStore } from "react";

/** Never changes — we only care about server snapshot vs. client snapshot. */
const subscribe = () => () => {};

/**
 * Renders a timestamp in the *viewer's* timezone.
 *
 * The server has no idea what timezone the phone is in (Vercel runs UTC), so
 * the server pass and the client pass legitimately produce different text.
 * useSyncExternalStore returns false during SSR and true once hydrated, which
 * forces exactly one re-render in the browser — where toLocaleString finally
 * has the real timezone. suppressHydrationWarning marks the mismatch as
 * intended rather than a bug.
 */
export default function LocalDateTime({
  iso,
  withWeekday = true,
}: {
  iso: string;
  withWeekday?: boolean;
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const text = new Date(iso).toLocaleString(undefined, {
    weekday: withWeekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <time dateTime={iso} data-tz={hydrated ? "local" : "utc"} suppressHydrationWarning>
      {text}
    </time>
  );
}

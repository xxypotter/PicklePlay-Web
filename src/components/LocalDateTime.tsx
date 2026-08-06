"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n/client";

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
  // Not the browser's locale: someone reading the app in Chinese on an
  // en-US phone should get Chinese dates too.
  const t = useT();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  /*
   * The timezone has to depend on `hydrated`, and that is the whole trick.
   *
   * Formatting identically in both passes looks equivalent and silently fails.
   * The hydration pass runs in the browser, so it computes the *local* string
   * into React's tree, while suppressHydrationWarning tells React to leave the
   * server's UTC text in the DOM. The two then disagree, invisibly: every
   * later render produces that same local string, React compares it against
   * the copy it already holds, finds no change, and never patches the DOM. The
   * page keeps showing UTC forever.
   *
   * Pinning the pre-hydration pass to UTC makes it match the server exactly,
   * so the post-hydration render is the first time the text actually changes —
   * and React updates it. It also makes the server output deterministic
   * instead of depending on the server's own timezone.
   */
  const text = new Date(iso).toLocaleString(t.locale, {
    weekday: withWeekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: hydrated ? undefined : "UTC",
  });

  return (
    <time dateTime={iso} data-tz={hydrated ? "local" : "utc"} suppressHydrationWarning>
      {text}
    </time>
  );
}

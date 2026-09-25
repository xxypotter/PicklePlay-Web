"use client";

import { useEffect, useRef } from "react";
import { comingSaturday, nextWeekly, toLocalInput } from "@/lib/dates";

/**
 * A date-and-time field showing the *viewer's* wall clock.
 *
 * This exists because of a bug worth remembering. These forms are client
 * components, but Next renders them on the server first — where the timezone
 * is UTC — and React deliberately leaves an uncontrolled input's value alone
 * during hydration. So a value computed at render time was the UTC wall clock,
 * and it stuck: a session at 3pm Pacific opened its edit form reading 10:00 PM,
 * disagreeing with every other screen, which formats in the browser.
 *
 * The fix is to write nothing on the server and set the value once in the
 * browser, where the timezone is real. A field that is briefly empty is much
 * better than one confidently showing the wrong time — the whole point of this
 * screen is telling people when to turn up.
 */
export default function DateTimeField({
  id,
  name,
  /** ISO instant to show, or null to default to the coming Saturday at 6pm. */
  initialIso = null,
  /**
   * Copying a session: show the coming occurrence of this instant's weekday
   * and time instead. Worked out here rather than on the server for the same
   * reason as everything else in this field — only the browser knows which
   * weekday and hour the organizer means.
   */
  weeklyAfter = null,
  required = true,
}: {
  id: string;
  name: string;
  initialIso?: string | null;
  weeklyAfter?: string | null;
  required?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = toLocalInput(
      weeklyAfter
        ? nextWeekly(new Date(weeklyAfter))
        : initialIso
          ? new Date(initialIso)
          : comingSaturday(),
    );
  }, [initialIso, weeklyAfter]);

  return (
    <input
      ref={ref}
      id={id}
      name={name}
      className="field"
      type="datetime-local"
      required={required}
      suppressHydrationWarning
    />
  );
}

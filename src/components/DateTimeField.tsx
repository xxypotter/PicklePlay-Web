"use client";

import { useEffect, useRef } from "react";

/** `datetime-local` wants a wall-clock string built from local parts. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** The usual slot, and it saves a lot of tapping. */
function nextSevenPm(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  if (d.getHours() >= 19) d.setDate(d.getDate() + 1);
  d.setHours(19);
  return d;
}

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
  /** ISO instant to show, or null to default to the next 7pm. */
  initialIso = null,
  required = true,
}: {
  id: string;
  name: string;
  initialIso?: string | null;
  required?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = toLocalInput(initialIso ? new Date(initialIso) : nextSevenPm());
  }, [initialIso]);

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

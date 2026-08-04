"use client";

import { useState } from "react";

/** The courts this group actually plays at. Anything else is typed in. */
export const VENUES = [
  "Pickleball Katy",
  "ERA",
  "Pace",
  "Pickleball Village",
] as const;

/** Katy takes bookings through its own app, so every session there says so. */
export const KATY_NOTE = "Please register in Playbypoint App";

const OTHER = "__other";

/**
 * Adds the Katy booking note, or takes it away again, without ever touching
 * something the organizer wrote themselves.
 *
 * Exported so both forms apply the same rule: the note appears when you pick
 * Katy with an empty notes box, and disappears when you move away from Katy
 * *only* if the box still contains exactly that note and nothing else.
 */
export function noteForVenue(venue: string, currentNotes: string): string {
  if (venue === "Pickleball Katy") {
    return currentNotes.trim() === "" ? KATY_NOTE : currentNotes;
  }
  return currentNotes.trim() === KATY_NOTE ? "" : currentNotes;
}

/**
 * Location as a dropdown, plus an escape hatch.
 *
 * Buttons in a row were the first attempt and they don't survive a phone —
 * "Pickleball Katy" and "Pickleball Village" both truncate at a third of a
 * 375px screen, which defeats the point of offering them. A native select
 * renders as a full-height picker on iOS and has room for every name.
 */
export default function LocationField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const isVenue = (VENUES as readonly string[]).includes(value);
  // An existing session with a one-off location opens on Other, already filled.
  const [other, setOther] = useState(!isVenue && value.trim() !== "");

  const selected = isVenue ? value : other ? OTHER : "";

  const choose = (next: string) => {
    if (next === OTHER) {
      setOther(true);
      // Clear a venue name so the free-text box starts empty rather than
      // inviting them to edit "ERA" into something else.
      if (isVenue) onChange("");
      return;
    }
    setOther(false);
    onChange(next);
  };

  return (
    <div>
      {/* The submitted value is always this, whichever control produced it. */}
      <input type="hidden" name={name} value={value} />

      <select
        className="field"
        value={selected}
        onChange={(e) => choose(e.target.value)}
        aria-label="Location"
      >
        <option value="">Choose a location…</option>
        {VENUES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        <option value={OTHER}>Other</option>
      </select>

      {other ? (
        <input
          className="field mt-2"
          placeholder="Where are you playing?"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={80}
          autoFocus
        />
      ) : null}
    </div>
  );
}

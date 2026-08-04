"use client";

import { useState } from "react";

/** The two courts this group actually plays at. Anything else is typed in. */
export const VENUES = ["Pickleball Katy", "ERA"] as const;

/** Katy takes bookings through its own app, so every session there says so. */
export const KATY_NOTE = "Please register in Playbypoint App";

/**
 * Adds the Katy booking note, or takes it away again, without ever touching
 * something the organizer wrote themselves.
 *
 * Exported so both forms apply the same rule: the note appears when you pick
 * Katy and an empty notes box, and disappears when you move away from Katy
 * *only* if the box still contains exactly that note and nothing else.
 */
export function noteForVenue(venue: string, currentNotes: string): string {
  if (venue === "Pickleball Katy") {
    return currentNotes.trim() === "" ? KATY_NOTE : currentNotes;
  }
  return currentNotes.trim() === KATY_NOTE ? "" : currentNotes;
}

/**
 * Location as a short list plus an escape hatch.
 *
 * Typing "Pickleball Katy" correctly every week is the kind of small friction
 * that produces three spellings of the same venue in the history, so the usual
 * two are buttons. Other keeps the free-text field for anywhere else.
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
  const matchesVenue = (VENUES as readonly string[]).includes(value);
  // An existing session with a one-off location opens on Other, already filled.
  const [other, setOther] = useState(!matchesVenue && value.trim() !== "");

  const pick = (venue: string) => {
    setOther(false);
    onChange(venue);
  };

  return (
    <div>
      {/* The submitted value is always this, whichever control produced it. */}
      <input type="hidden" name={name} value={value} />

      <div className="grid grid-cols-3 gap-2">
        {VENUES.map((v) => (
          <Choice key={v} label={v} active={!other && value === v} onSelect={() => pick(v)} />
        ))}
        <Choice
          label="Other"
          active={other}
          onSelect={() => {
            setOther(true);
            if (matchesVenue) onChange("");
          }}
        />
      </div>

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

function Choice({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`truncate rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
          : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      {label}
    </button>
  );
}

"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

/** The courts this group actually plays at. Anything else is typed in. */
export const VENUES = [
  "Pickleball Katy",
  "ERA",
  "Pace",
  "Pickleball Village",
] as const;

const OTHER = "__other";

/**
 * Every language's version of the Katy booking note.
 *
 * Removal has to recognise all of them, not just the current one. The note is
 * written into the session in whatever language the organizer had at the time;
 * if they later switch language and change venue, matching only the new
 * wording would leave the old note stranded on a session that isn't at Katy.
 */
const KATY_NOTES = new Set([
  "Please register in Playbypoint App",
  "请在 Playbypoint App 上登记",
  "請在 Playbypoint App 上登記",
]);

/**
 * Adds the Katy booking note, or takes it away again, without ever touching
 * something the organizer wrote themselves.
 *
 * Exported so both forms apply the same rule: the note appears when you pick
 * Katy with an empty notes box, and disappears when you move away from Katy
 * *only* if the box still contains exactly that note and nothing else.
 */
export function noteForVenue(venue: string, currentNotes: string, note: string): string {
  if (venue === "Pickleball Katy") {
    return currentNotes.trim() === "" ? note : currentNotes;
  }
  return KATY_NOTES.has(currentNotes.trim()) ? "" : currentNotes;
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
  const t = useT();
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
        aria-label={t("form.location")}
      >
        <option value="">{t("form.location.choose")}</option>
        {VENUES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        <option value={OTHER}>{t("form.location.other")}</option>
      </select>

      {other ? (
        <input
          className="field mt-2"
          placeholder={t("form.location.otherPlaceholder")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={80}
          autoFocus
        />
      ) : null}
    </div>
  );
}

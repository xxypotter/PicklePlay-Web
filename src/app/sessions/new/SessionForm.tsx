"use client";

import { useActionState } from "react";
import { createSessionAction } from "@/lib/sessions/actions";
import type { FormState } from "@/lib/auth/types";

/**
 * "King of the court" is deliberately absent: the generator doesn't implement
 * court promotion yet and would silently fall back to balanced. Offering a
 * format that quietly does something else is worse than not offering it.
 */
const FORMATS = [
  { key: "balanced", label: "Balanced round robin", hint: "Teams matched by rating, partners rotate" },
  { key: "fixed", label: "Fixed partners", hint: "Pairs stay together, opponents rotate" },
  { key: "social", label: "Social / random", hint: "Random partners, no rating balancing" },
];

/** Default to the next 7pm — the usual slot, and saves a lot of tapping. */
function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  if (d.getHours() >= 19) d.setDate(d.getDate() + 1);
  d.setHours(19);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SessionForm() {
  const [state, action, pending] = useActionState(createSessionAction, {} as FormState);

  return (
    <form
      action={action}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        // The server can't know the phone's timezone, so convert here.
        const form = e.currentTarget;
        const local = (form.elements.namedItem("startsAtLocal") as HTMLInputElement).value;
        const hidden = form.elements.namedItem("startsAt") as HTMLInputElement;
        hidden.value = local ? new Date(local).toISOString() : "";
      }}
    >
      <div>
        <label className="label" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          className="field"
          maxLength={80}
          defaultValue="Tuesday night"
          required
          autoFocus
        />
      </div>

      <div>
        <label className="label" htmlFor="location">
          Location
        </label>
        <input id="location" name="location" className="field" placeholder="Which courts?" />
      </div>

      <div>
        <label className="label" htmlFor="startsAtLocal">
          Date &amp; time
        </label>
        <input
          id="startsAtLocal"
          name="startsAtLocal"
          className="field"
          type="datetime-local"
          defaultValue={defaultStart()}
          required
        />
        <input type="hidden" name="startsAt" />
      </div>

      <div>
        <label className="label" htmlFor="courtNames">
          Which courts?
        </label>
        <input
          id="courtNames"
          name="courtNames"
          className="field"
          defaultValue="1, 2"
          placeholder="3, 4"
          required
        />
        <p className="hint">
          Separate with commas — court numbers or names, whatever the venue calls
          them. Players see these on their matchup.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="maxPlayers">
          Max players
        </label>
        <input
          id="maxPlayers"
          name="maxPlayers"
          className="field"
          type="number"
          inputMode="numeric"
          min={4}
          max={64}
          defaultValue={12}
          required
        />
        <p className="hint">Anyone after this joins the waitlist.</p>
      </div>

      <div>
        <label className="label" htmlFor="format">
          Format
        </label>
        <select id="format" name="format" className="field" defaultValue="balanced">
          {FORMATS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <p className="hint">{FORMATS[0].hint} — you can override any matchup.</p>
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          className="field"
          rows={2}
          placeholder="Bring a yellow ball, gate code 1234…"
        />
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-4">
        <input type="checkbox" name="rated" defaultChecked className="size-5 accent-[var(--accent)]" />
        <span>
          <span className="font-medium">Counts toward ratings</span>
          <span className="hint block">Turn off for a casual night.</span>
        </span>
      </label>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create session"}
      </button>
    </form>
  );
}

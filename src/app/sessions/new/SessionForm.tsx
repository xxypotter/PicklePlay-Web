"use client";

import { useActionState, useState } from "react";
import { createSessionAction } from "@/lib/sessions/actions";
import type { FormState } from "@/lib/auth/types";

const FORMATS = [
  {
    key: "regular",
    label: "Regular round robin",
    hint: "Partner with everyone once before anyone repeats.",
  },
  {
    key: "balanced",
    label: "Balanced round robin",
    hint: "Teams matched so both sides average a similar rating.",
  },
  {
    key: "fixed",
    label: "Fixed partners",
    hint: "Pairs stay together all night; opponents rotate.",
  },
  {
    key: "custom",
    label: "Custom",
    hint: "Rounds are still generated, but expect to rearrange courts yourself.",
  },
];

const MAX_COURTS = 4;
const PLAYERS_PER_COURT = 6;

/** Default to the next 7pm — the usual slot, and saves a lot of tapping. */
function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  if (d.getHours() >= 19) d.setDate(d.getDate() + 1);
  d.setHours(19);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface PickablePlayer {
  id: string;
  username: string;
  rating: number | null;
}

export default function SessionForm({ roster }: { roster: PickablePlayer[] }) {
  const [state, action, pending] = useActionState(createSessionAction, {} as FormState);
  const [courts, setCourts] = useState("1, 2");
  const [format, setFormat] = useState("regular");
  const [invited, setInvited] = useState<string[]>([]);

  const toggle = (id: string) =>
    setInvited((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const courtCount = courts.split(",").map((c) => c.trim()).filter(Boolean).length;
  const seatCap = Math.min(MAX_COURTS, Math.max(1, courtCount)) * PLAYERS_PER_COURT;

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
          defaultValue="PicklePlay Game"
          required
          autoFocus
        />
      </div>

      <div>
        <label className="label" htmlFor="location">
          Location
        </label>
        <input id="location" name="location" className="field" placeholder="Club name" />
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
          value={courts}
          onChange={(e) => setCourts(e.target.value)}
          placeholder="3, 4"
          required
        />
        <p className="hint">
          Separate with commas — court numbers or names, whatever the venue calls
          them. Up to {MAX_COURTS}. Players see these on their matchup.
        </p>
        {courtCount > MAX_COURTS ? (
          <p className="mt-1 text-sm font-medium text-[var(--danger)]">
            {MAX_COURTS} courts maximum.
          </p>
        ) : null}
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
          max={seatCap}
          defaultValue={12}
          required
        />
        <p className="hint">
          Up to {PLAYERS_PER_COURT} per court, so {seatCap} for{" "}
          {Math.min(MAX_COURTS, Math.max(1, courtCount))} court
          {courtCount === 1 ? "" : "s"}. Anyone after that joins the waitlist.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="format">
          Format
        </label>
        <select
          id="format"
          name="format"
          className="field"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          {FORMATS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <p className="hint">
          {FORMATS.find((f) => f.key === format)?.hint} You can override any matchup.
        </p>
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

      {roster.length > 0 ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="label mb-0">Who&apos;s playing</span>
            <button
              type="button"
              onClick={() =>
                setInvited((prev) =>
                  prev.length === roster.length ? [] : roster.map((r) => r.id),
                )
              }
              className="text-xs font-semibold text-[var(--accent)] underline"
            >
              {invited.length === roster.length ? "Clear all" : "Select all"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {roster.map((p) => {
              const on = invited.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-pressed={on}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5
                    text-left text-sm transition ${
                      on
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium"
                        : "border-[var(--border)] text-[var(--muted)]"
                    }`}
                >
                  <span className="truncate">{p.username}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    {p.rating === null ? "—" : p.rating.toFixed(2)}
                  </span>
                </button>
              );
            })}
          </div>

          {invited.map((id) => (
            <input key={id} type="hidden" name="invite" value={id} />
          ))}

          <p className="hint">
            {invited.length === 0
              ? "Optional — leave empty and people RSVP themselves."
              : `${invited.length} added and marked in. They can opt out themselves from the session page.`}
          </p>
        </div>
      ) : null}

      <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-4">
        <input type="checkbox" name="rated" defaultChecked className="size-5 accent-[var(--accent)]" />
        <span>
          <span className="font-medium">Counts toward ratings</span>
          <span className="hint block">Turn off for a casual event.</span>
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

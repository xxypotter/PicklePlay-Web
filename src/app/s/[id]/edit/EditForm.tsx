"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/lib/auth/types";
import { updateSessionAction } from "@/lib/sessions/edit-actions";
import DateTimeField from "@/components/DateTimeField";

const FORMATS = [
  { key: "regular", label: "Regular round robin", hint: "Partner with everyone once before anyone repeats." },
  { key: "balanced", label: "Balanced round robin", hint: "Teams matched so both sides average a similar rating." },
  { key: "fixed", label: "Fixed partners", hint: "Pairs stay together all night; opponents rotate." },
  { key: "custom", label: "Custom", hint: "Rounds are still generated, but expect to rearrange courts yourself." },
];

const MAX_COURTS = 4;
const PLAYERS_PER_COURT = 6;

export interface EditableSession {
  id: string;
  title: string;
  location: string | null;
  startsAtIso: string;
  courtNames: string[];
  maxPlayers: number;
  format: string;
  rated: boolean;
  notes: string | null;
  confirmed: number;
}

export default function EditForm({ session }: { session: EditableSession }) {
  const [state, action, pending] = useActionState(updateSessionAction, {} as FormState);
  const [courts, setCourts] = useState(session.courtNames.join(", "));
  const [format, setFormat] = useState(session.format);
  const [maxPlayersText, setMaxPlayersText] = useState(String(session.maxPlayers));

  const courtCount = courts.split(",").map((c) => c.trim()).filter(Boolean).length;
  const seatCap = Math.min(MAX_COURTS, Math.max(1, courtCount)) * PLAYERS_PER_COURT;
  const maxPlayers = Number.parseInt(maxPlayersText, 10);
  const maxPlayersValid =
    Number.isInteger(maxPlayers) && maxPlayers >= session.confirmed && maxPlayers <= seatCap;

  return (
    <form
      action={action}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        const form = e.currentTarget;
        const local = (form.elements.namedItem("startsAtLocal") as HTMLInputElement).value;
        const hidden = form.elements.namedItem("startsAt") as HTMLInputElement;
        hidden.value = local ? new Date(local).toISOString() : "";
      }}
    >
      <input type="hidden" name="sessionId" value={session.id} />
      <input type="hidden" name="startsAt" />

      <div>
        <label className="label" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          className="field"
          maxLength={80}
          defaultValue={session.title}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="location">
          Location
        </label>
        <input
          id="location"
          name="location"
          className="field"
          placeholder="Club name"
          defaultValue={session.location ?? ""}
        />
      </div>

      <div>
        <label className="label" htmlFor="startsAtLocal">
          Date &amp; time
        </label>
        <DateTimeField
          id="startsAtLocal"
          name="startsAtLocal"
          initialIso={session.startsAtIso}
        />
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
          required
        />
        <p className="hint">Separate with commas. Up to {MAX_COURTS}.</p>
      </div>

      <div>
        <label className="label" htmlFor="maxPlayers">
          Max players
        </label>
        <input
          id="maxPlayers"
          name="maxPlayers"
          className="field"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={maxPlayersText}
          onChange={(e) => setMaxPlayersText(e.target.value.replace(/\D/g, "").slice(0, 2))}
          required
        />
        {maxPlayersText !== "" && !maxPlayersValid ? (
          <p className="mt-1.5 text-sm font-medium text-[var(--danger)]">
            Between {session.confirmed} and {seatCap} — {session.confirmed} are already in.
          </p>
        ) : (
          <p className="hint">
            Up to {PLAYERS_PER_COURT} per court, so {seatCap} for{" "}
            {Math.min(MAX_COURTS, Math.max(1, courtCount))} court
            {courtCount === 1 ? "" : "s"}.
          </p>
        )}
      </div>

      <div>
        <span className="label">Format</span>
        <input type="hidden" name="format" value={format} />
        <div className="flex flex-col gap-2">
          {FORMATS.map((f) => {
            const on = f.key === format;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFormat(f.key)}
                aria-pressed={on}
                className={`rounded-xl border p-3 text-left transition ${
                  on
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <span className={`block text-sm font-semibold ${on ? "text-[var(--accent)]" : ""}`}>
                  {f.label}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{f.hint}</span>
              </button>
            );
          })}
        </div>
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
          defaultValue={session.notes ?? ""}
        />
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-4">
        <input
          type="checkbox"
          name="rated"
          defaultChecked={session.rated}
          className="size-5 accent-[var(--accent)]"
        />
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
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

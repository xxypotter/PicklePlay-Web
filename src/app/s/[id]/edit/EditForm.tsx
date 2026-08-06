"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/lib/auth/types";
import { updateSessionAction } from "@/lib/sessions/edit-actions";
import DateTimeField from "@/components/DateTimeField";
import LocationField, { noteForVenue } from "@/components/LocationField";
import { useT } from "@/lib/i18n/client";

/** Keys only — the labels and descriptions come from the dictionary. */
const FORMAT_KEYS = ["regular", "balanced", "fixed", "custom"] as const;

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
  const t = useT();
  const [state, action, pending] = useActionState(updateSessionAction, {} as FormState);
  const [courts, setCourts] = useState(session.courtNames.join(", "));
  const [format, setFormat] = useState(session.format);
  const [maxPlayersText, setMaxPlayersText] = useState(String(session.maxPlayers));
  const [location, setLocation] = useState(session.location ?? "");
  const [notes, setNotes] = useState(session.notes ?? "");

  /* Picking Katy fills in its booking note; leaving Katy takes it back out.
     noteForVenue never touches anything the organizer typed themselves. */
  const changeLocation = (next: string) => {
    setLocation(next);
    setNotes((current) => noteForVenue(next, current, t("form.locationKatyNote")));
  };


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
          {t("form.title")}
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
          {t("form.location")}
        </label>
        <LocationField name="location" value={location} onChange={changeLocation} />
      </div>

      <div>
        <label className="label" htmlFor="startsAtLocal">
          {t("form.datetime")}
        </label>
        <DateTimeField
          id="startsAtLocal"
          name="startsAtLocal"
          initialIso={session.startsAtIso}
        />
      </div>

      <div>
        <label className="label" htmlFor="courtNames">
          {t("form.courts")}
        </label>
        <input
          id="courtNames"
          name="courtNames"
          className="field"
          value={courts}
          onChange={(e) => setCourts(e.target.value)}
          required
        />
        <p className="hint">{t("form.courtsHint", { max: MAX_COURTS })}</p>
      </div>

      <div>
        <label className="label" htmlFor="maxPlayers">
          {t("form.maxPlayers")}
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
            {t("form.maxPlayersFloor", { low: session.confirmed, cap: seatCap })}
          </p>
        ) : (
          <p className="hint">
            {t("form.maxPlayersHint", {
              perCourt: PLAYERS_PER_COURT,
              total: seatCap,
              courts: Math.min(MAX_COURTS, Math.max(1, courtCount)),
            })}
          </p>
        )}
      </div>

      <div>
        <span className="label">{t("form.formatLabel")}</span>
        <input type="hidden" name="format" value={format} />
        <div className="flex flex-col gap-2">
          {FORMAT_KEYS.map((key) => {
            const on = key === format;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFormat(key)}
                aria-pressed={on}
                className={`rounded-xl border p-3 text-left transition ${
                  on
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <span className={`block text-sm font-semibold ${on ? "text-[var(--accent)]" : ""}`}>
                  {t(`format.short.${key}`)}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">
                  {t(`form.desc.${key}`)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="notes">
          {t("form.notes")}
        </label>
        <textarea
          id="notes"
          name="notes"
          className="field"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
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
          <span className="font-medium">{t("form.rated")}</span>
          <span className="hint block">{t("form.ratedHint")}</span>
        </span>
      </label>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? t("common.saving") : t("form.saveChanges")}
      </button>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { createSessionAction } from "@/lib/sessions/actions";
import type { FormState } from "@/lib/auth/types";
import DateTimeField from "@/components/DateTimeField";
import LocationField, { noteForVenue } from "@/components/LocationField";
import { useT } from "@/lib/i18n/client";

/** Keys only — the labels and descriptions come from the dictionary. */
const FORMAT_KEYS = ["regular", "balanced", "fixed", "custom"] as const;

const MAX_COURTS = 4;
const PLAYERS_PER_COURT = 6;

export interface PickablePlayer {
  id: string;
  username: string;
  rating: number | null;
}

export default function SessionForm({
  roster,
  canMakePrivate = false,
}: {
  roster: PickablePlayer[];
  /** Super admin only; the checkbox simply isn't rendered for anyone else. */
  canMakePrivate?: boolean;
}) {
  const t = useT();
  const [state, action, pending] = useActionState(createSessionAction, {} as FormState);
  const [courts, setCourts] = useState("1, 2");
  const [format, setFormat] = useState("regular");
  const [invited, setInvited] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  /* Picking Katy fills in its booking note; leaving Katy takes it back out.
     noteForVenue never touches anything the organizer typed themselves. */
  const changeLocation = (next: string) => {
    setLocation(next);
    setNotes((current) => noteForVenue(next, current, t("form.locationKatyNote")));
  };

  /*
   * Held as text, not a number.
   *
   * Coercing on every keystroke meant clearing the box snapped it to 1, and
   * from there you could never select-and-replace it — you'd be typing "15"
   * onto a stubborn "1". The field now accepts anything you type, including
   * empty, and validity is reported separately.
   */
  const [maxPlayersText, setMaxPlayersText] = useState("9");

  const courtCount = courts.split(",").map((c) => c.trim()).filter(Boolean).length;
  const seatCap = Math.min(MAX_COURTS, Math.max(1, courtCount)) * PLAYERS_PER_COURT;

  const maxPlayers = Number.parseInt(maxPlayersText, 10);
  const maxPlayersValid =
    Number.isInteger(maxPlayers) && maxPlayers >= 4 && maxPlayers <= seatCap;

  // While the number is half-typed, let the picker use the full court capacity
  // rather than collapsing to zero and disabling everyone.
  const cap = maxPlayersValid ? Math.min(maxPlayers, seatCap) : seatCap;
  const atCap = invited.length >= cap;

  const toggle = (id: string) =>
    setInvited((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= cap ? prev : [...prev, id],
    );

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
          {t("form.title")}
        </label>
        <input
          id="title"
          name="title"
          className="field"
          maxLength={80}
          defaultValue={t("form.defaultTitle")}
          required
          autoFocus
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
        <DateTimeField id="startsAtLocal" name="startsAtLocal" />
        <input type="hidden" name="startsAt" />
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
          placeholder={t("form.courtsPlaceholder")}
          required
        />
        <p className="hint">
          {t("form.courtsHint", { max: MAX_COURTS })}
          {t("form.courtsSeen")}
        </p>
        {courtCount > MAX_COURTS ? (
          <p className="mt-1 text-sm font-medium text-[var(--danger)]">
            {t("err.maxCourts", { max: MAX_COURTS })}
          </p>
        ) : null}
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
            {t("form.maxPlayersBad", { cap: seatCap })}
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

      {/* Format cards rather than a dropdown: the descriptions are the whole
          point, and a <select> hides them behind a tap. */}
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
                <span
                  className={`block text-sm font-semibold ${on ? "text-[var(--accent)]" : ""}`}
                >
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
          placeholder={t("form.notesPlaceholder")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {roster.length > 0 ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="label mb-0">
              {t("form.whosPlaying", { count: invited.length, max: cap })}
            </span>
            <button
              type="button"
              onClick={() =>
                setInvited((prev) =>
                  prev.length > 0 ? [] : roster.slice(0, cap).map((r) => r.id),
                )
              }
              className="text-xs font-semibold text-[var(--accent)] underline"
            >
              {invited.length > 0 ? t("form.clearAll") : t("form.selectAll")}
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
                  disabled={!on && atCap}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5
                    text-left text-sm transition disabled:opacity-40 ${
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
              ? t("form.invitedHint")
              : atCap
                ? t("form.invitedFull", { cap })
                : t("form.invitedAdded", { count: invited.length })}
          </p>
        </div>
      ) : null}

      <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-4">
        <input type="checkbox" name="rated" defaultChecked className="size-5 accent-[var(--accent)]" />
        <span>
          <span className="font-medium">{t("form.rated")}</span>
          <span className="hint block">{t("form.ratedHint")}</span>
        </span>
      </label>

      {canMakePrivate ? (
        <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-4">
          <input type="checkbox" name="isPrivate" className="size-5 accent-[var(--accent)]" />
          <span>
            <span className="font-medium">{t("form.private")}</span>
            <span className="hint block">{t("form.privateHint")}</span>
          </span>
        </label>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? t("form.creating") : t("form.create")}
      </button>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { createSessionAction } from "@/lib/sessions/actions";
import type { FormState } from "@/lib/auth/types";
import DateTimeField from "@/components/DateTimeField";
import LocationField, { noteForVenue } from "@/components/LocationField";
import { useT } from "@/lib/i18n/client";
import MlpTeamCount from "@/components/mlp/MlpTeamCount";
import { pairsCarryOver, teamsCarryOver, type CopySource } from "@/lib/sessions/copy";
import PlayerSearch from "@/components/PlayerSearch";
import { matchPlayers } from "@/lib/players/search";

/** Keys only — the labels and descriptions come from the dictionary. */
const FORMAT_KEYS = ["regular", "balanced", "gender", "fixed", "mlp", "custom"] as const;

import { maxCourtsFor, PLAYERS_PER_COURT } from "@/lib/sessions/limits";

export interface PickablePlayer {
  id: string;
  username: string;
  rating: number | null;
}

export default function SessionForm({
  roster,
  canMakePrivate = false,
  copy = null,
}: {
  roster: PickablePlayer[];
  /** Super admin only; the checkbox simply isn't rendered for anyone else. */
  canMakePrivate?: boolean;
  /**
   * A past session to start from. Everything is filled in except the players
   * and the date, which moves to the coming occurrence of the same weekday and
   * time. Nothing is created until the organizer presses Create, so the new
   * date can be checked first.
   */
  copy?: CopySource | null;
}) {
  const t = useT();
  const [state, action, pending] = useActionState(createSessionAction, {} as FormState);
  const [courts, setCourts] = useState(copy?.courts ?? "1, 2");
  const [format, setFormat] = useState<string>(copy?.format ?? "regular");
  /*
   * Empty for a new night or a plain copy. Copy with players starts from last
   * time's list in its order — confirmed, then waitlist — and the organizer
   * unticks anyone not coming before pressing Create.
   */
  const [invited, setInvited] = useState<string[]>(() => {
    const known = new Set(roster.map((p) => p.id));
    return (copy?.players ?? []).filter((id) => known.has(id));
  });
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState(copy?.location ?? "");
  const [notes, setNotes] = useState(copy?.notes ?? "");

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
  const [maxPlayersText, setMaxPlayersText] = useState(String(copy?.maxPlayers ?? 9));

  const maxCourts = maxCourtsFor(format);
  const courtCount = courts.split(",").map((c) => c.trim()).filter(Boolean).length;
  const seatCap = Math.min(maxCourts, Math.max(1, courtCount)) * PLAYERS_PER_COURT;

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

  /* A pick clears the search, ready for the next name — the usual job is
     adding several different people, not several with the same letters. */
  const shown = matchPlayers(roster, query);
  const pick = (id: string) => {
    toggle(id);
    setQuery("");
  };

  // A copied list can run past capacity: the extra people join the waitlist.
  const waitlisted = Math.max(0, invited.length - cap);
  // The same rules Create applies, so the note says what will really happen.
  const teamsKept = teamsCarryOver(copy?.teams, format, maxPlayers, invited);
  const pairsKept = pairsCarryOver(copy?.pairs, format, maxPlayers, invited).length;

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
      {copy ? (
        <div className="card-tight border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3">
          <p className="text-sm font-semibold">{t("form.copyingFrom", { title: copy.title })}</p>
          <p className="hint mt-0.5">
            {t(copy.players ? "form.copyingPlayersHint" : "form.copyingHint")}
          </p>
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="title">
          {t("form.title")}
        </label>
        <input
          id="title"
          name="title"
          className="field"
          maxLength={80}
          defaultValue={copy?.title ?? t("form.defaultTitle")}
          required
          autoFocus={!copy}
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
        <DateTimeField id="startsAtLocal" name="startsAtLocal" weeklyAfter={copy?.startsAt} />
        <input type="hidden" name="startsAt" />
        {copy ? <p className="hint">{t("form.copyDateHint")}</p> : null}
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
          {t("form.courtsHint", { max: maxCourts })}
          {t("form.courtsSeen")}
        </p>
        {courtCount > maxCourts ? (
          <p className="mt-1 text-sm font-medium text-[var(--danger)]">
            {t("err.maxCourts", { max: maxCourts })}
          </p>
        ) : null}
      </div>

      <div>
        {format === "mlp" ? <MlpTeamCount courts={courts} players={maxPlayersText} onChange={setMaxPlayersText} /> : null}
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
          readOnly={format === "mlp"}
          onChange={(e) => setMaxPlayersText(e.target.value.replace(/\D/g, "").slice(0, 2))}
          required
        />
        {maxPlayersText !== "" && !maxPlayersValid ? (
          <p className="mt-1.5 text-sm font-medium text-[var(--danger)]">
            {t("form.maxPlayersBad", { cap: seatCap })}
          </p>
        ) : format !== "mlp" ? (
          <p className="hint">
            {t("form.maxPlayersHint", {
              perCourt: PLAYERS_PER_COURT,
              total: seatCap,
              courts: Math.min(maxCourts, Math.max(1, courtCount)),
            })}
          </p>
        ) : null}
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
                onClick={() => { setFormat(key); if (key === "mlp" && format !== "mlp") { setCourts("1, 2, 3, 4"); setMaxPlayersText("24"); } }}
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
              {t("form.whosPlaying", { count: Math.min(invited.length, cap), max: cap })}
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

          <div className="mb-2">
            <PlayerSearch
              value={query}
              onChange={setQuery}
              onPickOnly={() => {
                if (shown.length === 1 && !atCap && !invited.includes(shown[0].id)) pick(shown[0].id);
              }}
            />
          </div>
          {shown.length === 0 ? (
            <p className="hint">{t("search.none", { query: query.trim() })}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            {shown.map((p) => {
              const on = invited.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p.id)}
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
              : waitlisted > 0
                ? t("form.invitedWaitlist", { count: waitlisted })
                : atCap
                  ? t("form.invitedFull", { cap })
                  : t("form.invitedAdded", { count: invited.length })}
          </p>

          {copy?.copyFrom ? <input type="hidden" name="copyFrom" value={copy.copyFrom} /> : null}
          {copy?.teams?.length ? (
            <p className="hint">
              {teamsKept
                ? t("form.copyTeamsKept", { count: copy.teams.length })
                : t("form.copyTeamsDropped")}
            </p>
          ) : null}
          {copy?.pairs?.length ? (
            <p className="hint">
              {format === "fixed"
                ? t("form.copyPairsKept", { count: pairsKept, total: copy.pairs.length })
                : t("form.copyPairsDropped")}
            </p>
          ) : null}
        </div>
      ) : null}

      <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-4">
        <input
          type="checkbox"
          name="rated"
          defaultChecked={copy ? copy.rated : true}
          className="size-5 accent-[var(--accent)]"
        />
        <span>
          <span className="font-medium">{t("form.rated")}</span>
          <span className="hint block">{t("form.ratedHint")}</span>
        </span>
      </label>

      {canMakePrivate ? (
        <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-4">
          <input
            type="checkbox"
            name="isPrivate"
            defaultChecked={copy?.isPrivate ?? false}
            className="size-5 accent-[var(--accent)]"
          />
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

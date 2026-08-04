"use client";

import { useActionState, useRef, useState } from "react";
import Avatar, { PRESET_COLORS, initialsOf } from "@/components/Avatar";
import type { FormState } from "@/lib/auth/types";
import { importRecordAction, setAvatarAction, setGenderAction } from "@/lib/profile/actions";

/**
 * Resize in the browser before upload.
 *
 * A phone photo is several megabytes; the avatar renders at 56px. Shrinking to
 * 160px square here keeps the stored data URL around 10KB, which is the only
 * reason storing it in the database at all is reasonable.
 */
async function toSquareDataUrl(file: File, size = 160): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function AvatarCard({
  username,
  avatar,
}: {
  username: string;
  avatar: string | null;
}) {
  const [state, action, pending] = useActionState(setAvatarAction, {} as FormState);
  const [choice, setChoice] = useState<string>(avatar ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickFile(file: File) {
    setBusy(true);
    try {
      setChoice(await toSquareDataUrl(file));
    } catch {
      // A file the browser can't decode; leaving the current choice is fine.
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={action} className="card mt-3">
      <h2 className="text-sm text-[var(--muted)]">Your picture</h2>

      <div className="mt-3 flex items-center gap-4">
        <Avatar username={username} avatar={choice || null} size={64} />
        <div className="flex-1">
          <input type="hidden" name="avatar" value={choice} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="btn-ghost text-sm disabled:opacity-50"
          >
            {busy ? "Resizing…" : "Upload a photo"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
            }}
          />
        </div>
      </div>

      <p className="hint mt-3">Or pick a colour:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PRESET_COLORS.map((color, i) => {
          const value = `preset:${i}`;
          const on = choice === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setChoice(value)}
              aria-label={`Colour ${i + 1}`}
              aria-pressed={on}
              style={{ background: color }}
              className={`flex size-10 items-center justify-center rounded-full text-sm
                font-semibold text-white transition ${
                  on ? "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--surface)]" : ""
                }`}
            >
              {initialsOf(username)}
            </button>
          );
        })}
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending || busy} className="btn-primary mt-4">
        {pending ? "Saving…" : "Save picture"}
      </button>
    </form>
  );
}

export function GenderCard({ gender }: { gender: string }) {
  const [state, action, pending] = useActionState(setGenderAction, {} as FormState);
  const [value, setValue] = useState(gender);

  const options = [
    { key: "male", label: "Men's" },
    { key: "female", label: "Women's" },
    { key: "unspecified", label: "Not listed" },
  ];

  return (
    <form action={action} className="card mt-3">
      <h2 className="text-sm text-[var(--muted)]">Rankings list</h2>
      <p className="hint">
        Play is always mixed. This only decides which ranking table you appear in.
      </p>

      <input type="hidden" name="gender" value={value} />
      <div className="mt-3 grid grid-cols-3 gap-2">
        {options.map((o) => {
          const on = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setValue(o.key)}
              aria-pressed={on}
              className={`rounded-xl border px-3 py-2.5 text-sm transition ${
                on
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                  : "border-[var(--border)]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn-primary mt-4">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function ImportRecordCard({
  importedMatches,
  importedWins,
  locked,
  playedHere,
}: {
  importedMatches: number;
  importedWins: number;
  locked: boolean;
  playedHere: number;
}) {
  const [state, action, pending] = useActionState(importRecordAction, {} as FormState);

  if (locked) {
    const losses = importedMatches - importedWins;
    const rate = importedMatches > 0 ? Math.round((importedWins / importedMatches) * 100) : 0;
    return (
      <section className="card mt-3">
        <h2 className="text-sm text-[var(--muted)]">Record before PicklePlay</h2>
        <p className="mt-2 text-lg font-bold">
          <span className="text-[var(--accent)]">{importedMatches}</span> matches ·{" "}
          <span className="text-[var(--accent)]">{rate}%</span> win rate
        </p>
        <p className="hint">
          {importedWins} won, {losses} lost. Counts toward your career totals but not your
          PicklePlay rating, which only follows matches played here.
        </p>
      </section>
    );
  }

  if (playedHere > 0) {
    return (
      <section className="card mt-3">
        <h2 className="text-sm text-[var(--muted)]">Record before PicklePlay</h2>
        <p className="hint mt-2">
          You&apos;ve already played here, so your record now comes from real results.
          Importing is only available before your first match.
        </p>
      </section>
    );
  }

  return (
    <form action={action} className="card mt-3">
      <h2 className="text-sm text-[var(--muted)]">Bring your record across</h2>
      <p className="hint">
        Played elsewhere? Enter your totals once, before your first match here. Shown on
        your profile; it doesn&apos;t affect your PicklePlay rating.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs text-[var(--muted)]">
          Matches played
          <input
            name="matches"
            className="field mt-1"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            placeholder="162"
            required
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Win rate %
          <input
            name="winRate"
            className="field mt-1"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            placeholder="59"
            required
          />
        </label>
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn-primary mt-4">
        {pending ? "Saving…" : "Import my record"}
      </button>
      <p className="hint text-center">You can only do this once.</p>
    </form>
  );
}

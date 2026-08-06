"use client";

import { useActionState, useRef, useState } from "react";
import Avatar, { PRESET_COLORS, initialsOf } from "@/components/Avatar";
import type { FormState } from "@/lib/auth/types";
import { useT } from "@/lib/i18n/client";
import { importRecordAction, setAvatarAction, setGenderAction } from "@/lib/profile/actions";
import type { T } from "@/lib/i18n/translate";

/**
 * Resize in the browser before upload.
 *
 * A phone photo is several megabytes; the avatar renders at 56px. Shrinking to
 * 160px square here keeps the stored data URL around 10KB, which is the only
 * reason storing it in the database at all is reasonable.
 *
 * Decodes through an <img> rather than createImageBitmap: iPhone photos are
 * HEIC, and Safari will render HEIC in an image element while createImageBitmap
 * refuses it. The <img> path also applies EXIF orientation, so pictures taken
 * sideways don't come out sideways.
 */
function toSquareDataUrl(file: File, t: T, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (!side) return reject(new Error(t("err.emptyImage")));

      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error(t("err.canvasUnavailable")));

      ctx.drawImage(
        img,
        (img.naturalWidth - side) / 2,
        (img.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("err.imageUnreadable")));
    };

    img.src = url;
  });
}

export function AvatarCard({
  username,
  avatar,
}: {
  username: string;
  avatar: string | null;
}) {
  const t = useT();
  const [state, action, pending] = useActionState(setAvatarAction, {} as FormState);
  const [choice, setChoice] = useState<string>(avatar ?? "");
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickFile(file: File) {
    setBusy(true);
    setReadError(null);
    try {
      setChoice(await toSquareDataUrl(file, t));
    } catch {
      setReadError(t("me.imageUnreadable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={action} className="card mt-3">
      <h2 className="text-sm text-[var(--muted)]">{t("me.picture")}</h2>

      <div className="relative mt-3 flex items-center gap-4">
        <Avatar username={username} avatar={choice || null} size={64} />
        <div className="flex-1">
          <input type="hidden" name="avatar" value={choice} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="btn-ghost text-sm disabled:opacity-50"
          >
            {busy ? t("me.resizing") : t("me.upload")}
          </button>
          {/*
            iOS decides what the picker offers from `accept`. Bare "image/*"
            can leave HEIC — which is what an iPhone actually shoots —
            unmatched, so the Photo Library entries grey out and the only live
            option is Files. Naming the extensions explicitly puts Photo Library
            back in play. Not display:none either: iOS Safari is unreliable
            about opening the picker for a hidden input.
          */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp"
            aria-hidden
            tabIndex={-1}
            className="absolute size-px overflow-hidden opacity-0"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
              // Reset so picking the same file twice still fires onChange.
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <p className="hint mt-3">{t("me.pickColour")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PRESET_COLORS.map((color, i) => {
          const value = `preset:${i}`;
          const on = choice === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setChoice(value)}
              aria-label={t("me.colourN", { n: i + 1 })}
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

      {state.error || readError ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
          {state.error ?? readError}
        </p>
      ) : null}

      <button type="submit" disabled={pending || busy} className="btn-primary mt-4">
        {pending ? t("common.saving") : t("me.savePicture")}
      </button>
    </form>
  );
}

export function GenderCard({ gender }: { gender: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(setGenderAction, {} as FormState);
  const [value, setValue] = useState(gender);

  const options = [
    { key: "male", label: t("me.gender.male") },
    { key: "female", label: t("me.gender.female") },
    { key: "unspecified", label: t("me.gender.unspecified") },
  ];

  return (
    <form action={action} className="card mt-3">
      <h2 className="text-sm text-[var(--muted)]">{t("me.gender")}</h2>
      <p className="hint">{t("me.genderHint")}</p>

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
        {pending ? t("common.saving") : t("common.save")}
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
  const t = useT();
  const [state, action, pending] = useActionState(importRecordAction, {} as FormState);

  if (locked) {
    const losses = importedMatches - importedWins;
    const rate = importedMatches > 0 ? Math.round((importedWins / importedMatches) * 100) : 0;
    return (
      <section className="card mt-3">
        <h2 className="text-sm text-[var(--muted)]">{t("import.title")}</h2>
        <p className="mt-2 text-lg font-bold">
          {t.rich("import.summary", {
            matches: (
              <span key="m" className="text-[var(--accent)]">
                {importedMatches}
              </span>
            ),
            rate: (
              <span key="r" className="text-[var(--accent)]">
                {rate}
              </span>
            ),
          })}
        </p>
        <p className="hint">
          {t("import.detail", {
            won: importedWins,
            lost: losses,
          })}
        </p>
      </section>
    );
  }

  if (playedHere > 0) {
    return (
      <section className="card mt-3">
        <h2 className="text-sm text-[var(--muted)]">{t("import.title")}</h2>
        <p className="hint mt-2">{t("import.playedHere")}</p>
      </section>
    );
  }

  return (
    <form action={action} className="card mt-3">
      <h2 className="text-sm text-[var(--muted)]">{t("import.formTitle")}</h2>
      <p className="hint">{t("import.formHint")}</p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs text-[var(--muted)]">
          {t("import.matches")}
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
          {t("import.winRatePercent")}
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
        {pending ? t("common.saving") : t("import.save")}
      </button>
      <p className="hint text-center">{t("import.onceOnly")}</p>
    </form>
  );
}

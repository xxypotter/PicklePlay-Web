"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { registerAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/auth/types";
import { RATING, SKILL_PICKER } from "@/lib/rating/constants";

const initial: FormState = {};

export default function RegisterForm({
  needsCode,
  codePrefill,
}: {
  needsCode: boolean;
  codePrefill: string;
}) {
  const [state, action, pending] = useActionState(registerAction, initial);
  const [hasDupr, setHasDupr] = useState(true);
  const [gender, setGender] = useState("male");

  return (
    <form action={action} className="flex flex-col gap-5">
      {needsCode ? (
        <div>
          <label className="label" htmlFor="inviteCode">
            Invite code
          </label>
          <input
            id="inviteCode"
            name="inviteCode"
            className="field font-mono tracking-[0.2em] uppercase"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            defaultValue={codePrefill}
            placeholder="K7P2WM"
            required
          />
          <p className="hint">From whoever runs your group.</p>
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="username">
          Pick a name
        </label>
        <input
          id="username"
          name="username"
          className="field"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          spellCheck={false}
          maxLength={20}
          required
          autoFocus
        />
        <p className="hint">
          3–20 characters. First person to claim a name keeps it, so pick something
          your group will recognize.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="pin">
            PIN
          </label>
          <input
            id="pin"
            name="pin"
            className="field"
            type="password"
            inputMode="numeric"
            pattern="\d{4,6}"
            autoComplete="new-password"
            minLength={4}
            maxLength={6}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pinConfirm">
            Confirm PIN
          </label>
          <input
            id="pinConfirm"
            name="pinConfirm"
            className="field"
            type="password"
            inputMode="numeric"
            pattern="\d{4,6}"
            autoComplete="new-password"
            minLength={4}
            maxLength={6}
            required
          />
        </div>
      </div>
      <p className="-mt-3 text-sm text-[var(--muted)]">
        4–6 digits. There&apos;s no email here, so if you forget it an admin resets it
        for you.
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="label">Gender</legend>
        <input type="hidden" name="gender" value={gender} />
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: "male", label: "Men" },
            { key: "female", label: "Women" },
            { key: "unspecified", label: "Not listed" },
          ].map((o) => (
            <Choice
              key={o.key}
              checked={gender === o.key}
              onSelect={() => setGender(o.key)}
              label={o.label}
            />
          ))}
        </div>
        <p className="hint">
          Play is mostly coed mix. This only decides which ranking table you appear
          in. Choose <span className="font-medium">Not listed</span> to stay out of
          the rankings entirely.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="label">Do you have a DUPR rating?</legend>
        <div className="grid grid-cols-2 gap-3">
          <Choice checked={hasDupr} onSelect={() => setHasDupr(true)} label="Yes" />
          <Choice checked={!hasDupr} onSelect={() => setHasDupr(false)} label="Not yet" />
        </div>
        <input type="hidden" name="ratingSource" value={hasDupr ? "dupr" : "picker"} />
      </fieldset>

      {hasDupr ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="dupr">
                Your DUPR
              </label>
              <input
                id="dupr"
                name="dupr"
                className="field"
                type="number"
                inputMode="decimal"
                step="0.001"
                min={RATING.MIN}
                max={RATING.MAX}
                placeholder="3.750"
                required={hasDupr}
              />
            </div>
            <div>
              <label className="label" htmlFor="reliability">
                Reliability %
              </label>
              <input
                id="reliability"
                name="reliability"
                className="field"
                type="number"
                inputMode="numeric"
                step="1"
                min={0}
                max={100}
                placeholder="60"
                required={hasDupr}
              />
            </div>
          </div>
          <p className="hint">
            Both are on your DUPR profile. Nothing connects to DUPR — this is a one-time
            starting point, and it&apos;s replaced by your real results here as you play.
            Reliability matters: a confident rating moves slowly, an uncertain one
            settles fast.
          </p>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="skill">
            Where are you roughly?
          </label>
          <select id="skill" name="skill" className="field" defaultValue="intermediate">
            {SKILL_PICKER.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="hint">
            A rough guess is fine. Your first handful of games will correct it.
          </p>
        </div>
      )}

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create account"}
      </button>

      <p className="text-center text-sm text-[var(--muted)]">
        Already have a name?{" "}
        <Link href="/login" className="font-medium text-[var(--accent)] underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

function Choice({
  checked,
  onSelect,
  label,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={`rounded-xl border px-4 py-3 text-base font-medium transition ${
        checked
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
          : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      {label}
    </button>
  );
}

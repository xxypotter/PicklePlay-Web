"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { registerAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/auth/types";
import { useT } from "@/lib/i18n/client";
import { RATING, SKILL_PICKER } from "@/lib/rating/constants";

const initial: FormState = {};

export default function RegisterForm({
  needsCode,
  codePrefill,
  next = "",
}: {
  needsCode: boolean;
  codePrefill: string;
  next?: string;
}) {
  const t = useT();
  const [state, action, pending] = useActionState(registerAction, initial);
  const [hasDupr, setHasDupr] = useState(true);
  const [gender, setGender] = useState("male");

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      {needsCode ? (
        <div>
          <label className="label" htmlFor="inviteCode">
            {t("auth.inviteCode")}
          </label>
          <input
            id="inviteCode"
            name="inviteCode"
            className="field font-mono tracking-[0.2em] uppercase"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            defaultValue={codePrefill}
            placeholder={t("auth.codePlaceholder")}
            required
          />
          <p className="hint">{t("auth.inviteCodeHint")}</p>
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="username">
          {t("auth.username")}
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
        <p className="hint">{t("auth.usernameHint")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="pin">
            {t("auth.pin")}
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
            {t("auth.pinConfirm")}
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
      <p className="-mt-3 text-sm text-[var(--muted)]">{t("auth.pinHint")}</p>

      <fieldset className="flex flex-col gap-2">
        <legend className="label">{t("me.gender")}</legend>
        <input type="hidden" name="gender" value={gender} />
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: "male", label: t("me.gender.male") },
            { key: "female", label: t("me.gender.female") },
            { key: "unspecified", label: t("me.gender.unspecified") },
          ].map((o) => (
            <Choice
              key={o.key}
              checked={gender === o.key}
              onSelect={() => setGender(o.key)}
              label={o.label}
            />
          ))}
        </div>
        <p className="hint">{t("me.genderHint")}</p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="label">{t("auth.haveDupr")}</legend>
        <div className="grid grid-cols-2 gap-3">
          <Choice
            checked={hasDupr}
            onSelect={() => setHasDupr(true)}
            label={t("auth.yes")}
          />
          <Choice
            checked={!hasDupr}
            onSelect={() => setHasDupr(false)}
            label={t("auth.notYet")}
          />
        </div>
        <input type="hidden" name="ratingSource" value={hasDupr ? "dupr" : "picker"} />
      </fieldset>

      {hasDupr ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="dupr">
                {t("auth.yourDupr")}
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
                placeholder={t("auth.duprPlaceholder")}
                required={hasDupr}
              />
            </div>
            <div>
              <label className="label" htmlFor="reliability">
                {t("auth.reliabilityPercent")}
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
                placeholder={t("common.optional")}
              />
            </div>
          </div>
          <p className="hint">{t("auth.duprHint")}</p>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="skill">
            {t("auth.skillLevel")}
          </label>
          <select id="skill" name="skill" className="field" defaultValue="intermediate">
            {SKILL_PICKER.map((s) => (
              <option key={s.key} value={s.key}>
                {t(`skill.${s.key}`)}
              </option>
            ))}
          </select>
          <p className="hint">{t("auth.skillHint")}</p>
        </div>
      )}

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? t("auth.creating") : t("auth.register")}
      </button>

      <p className="text-center text-sm text-[var(--muted)]">
        {t("auth.alreadyHaveName")}{" "}
        <Link
          href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-[var(--accent)] underline"
        >
          {t("auth.login")}
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

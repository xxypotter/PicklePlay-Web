"use client";

import { useTransition } from "react";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/config";
import { setLocaleAction } from "@/lib/i18n/actions";
import { useT } from "@/lib/i18n/client";

/**
 * Language picker.
 *
 * Each option is written in its own script and never translated — someone
 * looking for Chinese scans for 简体中文, not for whatever the current language
 * calls it. That also makes the control usable when the app is in a language
 * you can't read, which is exactly when you need it.
 */
export default function LanguageCard({ current }: { current: Locale }) {
  const t = useT();
  const [pending, start] = useTransition();

  return (
    <section className="card mt-3">
      <h2 className="text-sm font-medium text-[var(--muted)]">{t("me.language")}</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {LOCALES.map((code) => (
          <button
            key={code}
            type="button"
            aria-pressed={code === current}
            disabled={pending}
            onClick={() => start(() => void setLocaleAction(code))}
            className={`rounded-xl border px-3 py-3 text-sm font-medium transition disabled:opacity-50 ${
              code === current
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            {LOCALE_NAMES[code]}
          </button>
        ))}
      </div>
      <p className="hint">{t("me.languageHint")}</p>
    </section>
  );
}

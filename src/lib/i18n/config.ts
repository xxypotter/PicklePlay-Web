/**
 * Languages the app speaks.
 *
 * Three rather than two because Simplified and Traditional are not a character
 * swap: 設定/设置, 使用者/用户, 預設/默认 are different words, not different
 * glyphs, and running one through a converter produces text that reads as
 * translated-by-machine to anyone who uses the other.
 */
export const LOCALES = ["en", "zh-Hans", "zh-Hant"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** What the language picker shows — each in its own script, never translated. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

/** Cookie rather than only the account, so the choice applies before sign-in. */
export const LOCALE_COOKIE = "pp_locale";

export const isLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/**
 * Best guess from an Accept-Language header, for a first visit with no choice
 * stored. Region decides the script: zh-TW, zh-HK and zh-MO write Traditional,
 * everything else Simplified.
 */
export function localeFromHeader(header: string | null): Locale | null {
  if (!header) return null;

  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    if (!tag) continue;
    if (tag.startsWith("en")) return "en";
    if (tag.startsWith("zh")) {
      if (/\b(hant|tw|hk|mo)\b/.test(tag)) return "zh-Hant";
      return "zh-Hans";
    }
  }
  return null;
}

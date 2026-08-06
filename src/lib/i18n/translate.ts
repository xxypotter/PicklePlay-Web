import type { ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { en, type Dict, type DictKey } from "./dictionaries/en";
import { zhHans } from "./dictionaries/zh-Hans";
import { zhHant } from "./dictionaries/zh-Hant";

const DICTIONARIES: Record<Locale, Dict> = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

export type Values = Record<string, string | number>;

/**
 * A translator bound to one language.
 *
 * `count` is separate from the other values because plural selection has to
 * happen before substitution, and because Chinese has no plural forms at all —
 * the `.plural` key simply resolves to the same string there, which is correct
 * rather than a gap.
 */
export interface T {
  (key: DictKey, values?: Values): string;
  /** Picks `key` or `key.plural` on the English rules, then substitutes. */
  plural: (key: DictKey, count: number, values?: Values) => string;
  /**
   * Substitution where a slot is a React node rather than text.
   *
   * This exists so a highlighted number stays inside a translated sentence.
   * "{count} signed up" and "已报名 {count}" put that number in opposite
   * places, and splicing markup around a fragment of English would strand the
   * highlight at the wrong end of the Chinese.
   */
  rich: (key: DictKey, values: Record<string, ReactNode>) => ReactNode[];
  locale: Locale;
}

function substitute(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

export function getDictionary(locale: Locale): Dict {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export function makeT(locale: Locale): T {
  const dict = getDictionary(locale);

  const t = ((key: DictKey, values?: Values) =>
    substitute(dict[key] ?? en[key] ?? key, values)) as T;

  t.plural = (key: DictKey, count: number, values?: Values) => {
    const pluralKey = `${key}.plural` as DictKey;
    const chosen = count === 1 || !(pluralKey in dict) ? key : pluralKey;
    return substitute(dict[chosen] ?? en[chosen] ?? key, { count, ...values });
  };

  t.rich = (key: DictKey, values: Record<string, ReactNode>) => {
    const template = dict[key] ?? en[key] ?? key;
    // Capturing split alternates literal text and slot names.
    return template
      .split(/\{(\w+)\}/g)
      .map((part, i) => (i % 2 === 1 ? (values[part] ?? `{${part}}`) : part));
  };

  t.locale = locale;
  return t;
}

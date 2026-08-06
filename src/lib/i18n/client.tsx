"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { makeT, type T } from "./translate";

/**
 * The chosen language, handed down for client components.
 *
 * Only the locale crosses the boundary, not the dictionary — all three fit in
 * the bundle anyway, and sending a few hundred strings through the RSC payload
 * on every navigation to save nothing would be the wrong trade.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useT(): T {
  const locale = useContext(LocaleContext);
  return useMemo(() => makeT(locale), [locale]);
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

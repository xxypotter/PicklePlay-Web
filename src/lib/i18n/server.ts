import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, localeFromHeader, type Locale } from "./config";
import { makeT, type T } from "./translate";

/**
 * Which language to render in.
 *
 * The cookie wins, because it is set the instant someone picks a language and
 * works before sign-in — the login and registration screens have to be readable
 * by definition. The account column is the fallback that carries the choice to
 * a new phone, and is written alongside the cookie whenever a signed-in player
 * changes it.
 *
 * Accept-Language only decides the *first* visit, and only when nothing has
 * been chosen. Guessing over an explicit choice is how apps end up in a
 * language their user has already rejected.
 */
export async function getLocale(accountLocale?: string | null): Promise<Locale> {
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  if (isLocale(accountLocale)) return accountLocale;

  const header = (await headers()).get("accept-language");
  return localeFromHeader(header) ?? DEFAULT_LOCALE;
}

/** The translator for this request. */
export async function getT(accountLocale?: string | null): Promise<T> {
  return makeT(await getLocale(accountLocale));
}

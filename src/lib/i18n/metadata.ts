import type { Metadata } from "next";
import { getCurrentPlayer } from "@/lib/auth/session";
import type { DictKey } from "./dictionaries/en";
import { getT } from "./server";

/**
 * A page's browser-tab title, in the reader's language.
 *
 * Every page here wants the same "Screen · PicklePlay" shape, and every one of
 * them has to become a `generateMetadata` export to read the locale at all —
 * static `metadata` is evaluated without a request. One helper keeps that from
 * being twelve near-identical async functions.
 */
export function titleFor(key: DictKey): () => Promise<Metadata> {
  return async () => {
    // The account's language matters here too, or a signed-in player on a
    // fresh device gets a Chinese page under an English tab title.
    const me = await getCurrentPlayer();
    const t = await getT(me?.locale);
    return { title: `${t(key)} · ${t("app.name")}` };
  };
}

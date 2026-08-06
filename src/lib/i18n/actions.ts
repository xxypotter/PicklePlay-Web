"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players } from "@/lib/db/schema";
import { isLocale, LOCALE_COOKIE } from "./config";

/** A year — long enough that nobody re-picks their own language every month. */
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Remember the chosen language in two places on purpose.
 *
 * The cookie is what every render actually reads, so the change is instant and
 * still applies on the sign-in screen. The account column is what carries the
 * choice to a new phone, where there is no cookie yet.
 */
export async function setLocaleAction(next: string): Promise<void> {
  if (!isLocale(next)) return;

  const jar = await cookies();
  jar.set(LOCALE_COOKIE, next, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  const me = await getCurrentPlayer();
  if (me) {
    await getDb().update(players).set({ locale: next }).where(eq(players.id, me.id));
  }

  // Language changes every string on every screen, so nothing cached survives.
  revalidatePath("/", "layout");
}

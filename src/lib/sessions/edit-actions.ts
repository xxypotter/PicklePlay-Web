"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { sessions, signups } from "@/lib/db/schema";
import { requireOrganizer } from "./guards";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

const MAX_COURTS = 4;
const PLAYERS_PER_COURT = 6;
const FORMATS = ["regular", "balanced", "fixed", "custom"] as const;
type Format = (typeof FORMATS)[number];

/**
 * Change a session's details — only while it hasn't started.
 *
 * Once play begins the courts and format are baked into matches that already
 * exist, so editing them would leave the schedule describing a session that no
 * longer matches. The status check is the enforcement; the UI hiding the button
 * is only a courtesy.
 */
export async function updateSessionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = getDb();

  const sessionId = str(formData, "sessionId");
  await requireOrganizer(sessionId);

  const found = await db
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!found[0]) return { error: "That session no longer exists." };
  if (found[0].status !== "open") {
    return { error: "This session has started, so its details are locked." };
  }

  const title = str(formData, "title");
  if (!title || title.length > 80) {
    return { error: "Give the session a title (80 characters or fewer).", field: "title" };
  }

  const startsAt = new Date(str(formData, "startsAt"));
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Pick a date and time.", field: "startsAtLocal" };
  }

  const courtNames = str(formData, "courtNames")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (courtNames.length === 0) {
    return { error: "Name at least one court, e.g. 3, 4", field: "courtNames" };
  }
  if (courtNames.length > MAX_COURTS) {
    return { error: `${MAX_COURTS} courts maximum.`, field: "courtNames" };
  }
  if (new Set(courtNames.map((c) => c.toLowerCase())).size !== courtNames.length) {
    return { error: "Each court needs a different name.", field: "courtNames" };
  }
  if (courtNames.some((c) => c.length > 16)) {
    return { error: "Court names must be 16 characters or fewer.", field: "courtNames" };
  }

  const courtCount = courtNames.length;
  const seatCap = courtCount * PLAYERS_PER_COURT;
  const maxPlayers = Number(str(formData, "maxPlayers"));

  if (!Number.isInteger(maxPlayers) || maxPlayers < 4 || maxPlayers > seatCap) {
    return {
      error: `Max players must be between 4 and ${seatCap} for ${courtCount} court${
        courtCount === 1 ? "" : "s"
      }.`,
      field: "maxPlayers",
    };
  }

  // Lowering the cap below the confirmed roster would silently drop people.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(signups)
    .where(and(eq(signups.sessionId, sessionId), eq(signups.state, "in")));

  if (maxPlayers < count) {
    return {
      error: `${count} players are already in. Remove some before lowering the cap.`,
      field: "maxPlayers",
    };
  }

  const format = str(formData, "format") as Format;
  if (!FORMATS.includes(format)) return { error: "Pick a format.", field: "format" };

  await db
    .update(sessions)
    .set({
      title,
      location: str(formData, "location") || null,
      startsAt,
      courtNames,
      courtCount,
      maxPlayers,
      format,
      rated: formData.get("rated") !== null,
      notes: str(formData, "notes") || null,
    })
    .where(eq(sessions.id, sessionId));

  revalidatePath(`/s/${sessionId}`);
  revalidatePath("/");
  redirect(`/s/${sessionId}`);
}

"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { sessions, signups } from "@/lib/db/schema";
import { requireOrganizer } from "./guards";
import { getT } from "@/lib/i18n/server";

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
  const t = await getT();
  const db = getDb();

  const sessionId = str(formData, "sessionId");
  await requireOrganizer(sessionId);

  const found = await db
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!found[0]) return { error: t("err.sessionGone") };
  if (found[0].status !== "open") {
    return { error: t("err.sessionStarted") };
  }

  const title = str(formData, "title");
  if (!title || title.length > 80) {
    return { error: t("err.titleRequired"), field: "title" };
  }

  const startsAt = new Date(str(formData, "startsAt"));
  if (Number.isNaN(startsAt.getTime())) {
    return { error: t("err.pickDateTime"), field: "startsAtLocal" };
  }

  const courtNames = str(formData, "courtNames")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (courtNames.length === 0) {
    return { error: t("err.nameCourt"), field: "courtNames" };
  }
  if (courtNames.length > MAX_COURTS) {
    return { error: t("err.maxCourts", { max: MAX_COURTS }), field: "courtNames" };
  }
  if (new Set(courtNames.map((c) => c.toLowerCase())).size !== courtNames.length) {
    return { error: t("err.courtsDistinct"), field: "courtNames" };
  }
  if (courtNames.some((c) => c.length > 16)) {
    return { error: t("err.courtNameLong"), field: "courtNames" };
  }

  const courtCount = courtNames.length;
  const seatCap = courtCount * PLAYERS_PER_COURT;
  const maxPlayers = Number(str(formData, "maxPlayers"));

  if (!Number.isInteger(maxPlayers) || maxPlayers < 4 || maxPlayers > seatCap) {
    return {
      error: t.plural("err.maxPlayersRange", courtCount, {
        cap: seatCap,
        courts: courtCount,
      }),
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
      error: t("err.tooManyIn", { count }),
      field: "maxPlayers",
    };
  }

  const format = str(formData, "format") as Format;
  if (!FORMATS.includes(format)) return { error: t("err.pickFormat"), field: "format" };

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
  // The edit screen itself, or reopening it serves the values you just changed.
  revalidatePath(`/s/${sessionId}/edit`);
  revalidatePath(`/s/${sessionId}/play`);
  revalidatePath("/sessions");
  revalidatePath("/");
  redirect(`/s/${sessionId}`);
}

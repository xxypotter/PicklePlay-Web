"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireLogin, requireSuperAdmin } from "@/lib/auth/permissions";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { auditLog, players, playerStats } from "@/lib/db/schema";

/** Roughly a 160px JPEG; anything larger means the client resize didn't run. */
const MAX_AVATAR_BYTES = 80_000;

export async function setAvatarAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireLogin();
  const value = String(formData.get("avatar") ?? "").trim();

  if (value === "") {
    await getDb().update(players).set({ avatar: null }).where(eq(players.id, me.id));
  } else if (/^preset:\d{1,2}$/.test(value)) {
    await getDb().update(players).set({ avatar: value }).where(eq(players.id, me.id));
  } else if (value.startsWith("data:image/")) {
    if (value.length > MAX_AVATAR_BYTES) {
      return { error: "That image is too large. Try a smaller photo." };
    }
    await getDb().update(players).set({ avatar: value }).where(eq(players.id, me.id));
  } else {
    return { error: "That doesn't look like an image." };
  }

  revalidatePath("/me");
  revalidatePath("/leaderboard");
  return {};
}

export async function setGenderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireLogin();
  const value = String(formData.get("gender") ?? "");

  if (value !== "male" && value !== "female" && value !== "unspecified") {
    return { error: "Pick one of the options." };
  }

  await getDb().update(players).set({ gender: value }).where(eq(players.id, me.id));
  revalidatePath("/me");
  revalidatePath("/leaderboard");
  return {};
}

/**
 * Carry over a record from wherever they played before — SPEC.md §5.9.
 *
 * Display only. It never reaches the rating engine, which knows about matches
 * played here and nothing else; a self-reported win count can't be allowed to
 * move a number other people's ratings depend on.
 *
 * Allowed once, and only before playing here, so it's a starting statement
 * rather than something to top up after a bad night. The super admin can clear
 * it, which re-opens the one-time edit — without that a typo would be permanent.
 */
export async function importRecordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireLogin();
  const db = getDb();

  const matches = Number(String(formData.get("matches") ?? ""));
  const winRate = Number(String(formData.get("winRate") ?? ""));

  if (!Number.isInteger(matches) || matches < 1 || matches > 10_000) {
    return { error: "Matches must be a whole number between 1 and 10,000.", field: "matches" };
  }
  if (!Number.isFinite(winRate) || winRate < 0 || winRate > 100) {
    return { error: "Win rate must be between 0 and 100.", field: "winRate" };
  }

  const existing = await db
    .select({ importedAt: players.importedAt })
    .from(players)
    .where(eq(players.id, me.id))
    .limit(1);

  if (existing[0]?.importedAt) {
    return { error: "You've already imported a record. Ask the owner if it needs fixing." };
  }

  const stats = await db
    .select({ localMatches: playerStats.localMatches })
    .from(playerStats)
    .where(eq(playerStats.playerId, me.id))
    .limit(1);

  if ((stats[0]?.localMatches ?? 0) > 0) {
    return { error: "You've already played here, so your record is set from real results." };
  }

  const wins = Math.round((matches * winRate) / 100);

  await db
    .update(players)
    .set({ importedMatches: matches, importedWins: wins, importedAt: new Date() })
    .where(eq(players.id, me.id));

  revalidatePath("/me");
  revalidatePath(`/p/${me.username}`);
  return {};
}

/** Super admin only: wipe an imported record so the player can redo it. */
export async function clearImportedRecordAction(playerId: string): Promise<void> {
  const me = await requireSuperAdmin();
  const db = getDb();

  await db
    .update(players)
    .set({ importedMatches: 0, importedWins: 0, importedAt: null })
    .where(eq(players.id, playerId));

  await db.insert(auditLog).values({
    actorId: me.id,
    action: "player.clear_imported_record",
    targetType: "player",
    targetId: playerId,
  });

  revalidatePath("/admin");
}

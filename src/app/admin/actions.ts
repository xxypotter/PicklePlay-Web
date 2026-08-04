"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/permissions";
import { hashPin, validatePin } from "@/lib/auth/pin";
import { revokeAllSessions } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { auditLog, players, ratingSeeds } from "@/lib/db/schema";
import { generateInviteCode, setInviteCode } from "@/lib/invite";
import { RATING } from "@/lib/rating/constants";
import { recomputeAll, type RecomputeSummary } from "@/lib/rating/service";

export async function rotateInviteCodeAction(): Promise<void> {
  const me = await requireAdmin();

  const code = await setInviteCode(generateInviteCode(), me.id);

  await getDb().insert(auditLog).values({
    actorId: me.id,
    action: "invite_code.rotate",
    targetType: "settings",
    detail: `new code ${code}`,
  });

  revalidatePath("/admin");
}

/**
 * Promote a player to admin, or demote an admin back to player.
 *
 * Superadmin only. Admins deliberately cannot grant admin — otherwise the first
 * person you promote can promote everyone else, and "Jason decides who runs the
 * group" stops being true after one hop.
 */
export async function setRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireSuperAdmin();

  const targetId = String(formData.get("playerId") ?? "");
  const nextRole = String(formData.get("role") ?? "");

  if (nextRole !== "player" && nextRole !== "admin") {
    return { error: "Role must be player or admin." };
  }
  if (targetId === me.id) {
    return { error: "You can't change your own role." };
  }

  const db = getDb();
  const rows = await db
    .select({ id: players.id, username: players.username, role: players.role })
    .from(players)
    .where(eq(players.id, targetId))
    .limit(1);

  const target = rows[0];
  if (!target) return { error: "That player no longer exists." };

  // There is exactly one superadmin and no UI creates another. Guard anyway, so
  // a crafted request can't demote the owner and orphan the group.
  if (target.role === "superadmin") {
    return { error: "The super admin's role can't be changed here." };
  }
  if (target.role === nextRole) return {};

  await db.update(players).set({ role: nextRole }).where(eq(players.id, targetId));

  // A demoted admin shouldn't keep admin powers on an open phone until their
  // 90-day cookie expires.
  if (nextRole === "player") await revokeAllSessions(targetId);

  await db.insert(auditLog).values({
    actorId: me.id,
    action: "player.set_role",
    targetType: "player",
    targetId,
    detail: `${target.username}: ${target.role} -> ${nextRole}`,
  });

  revalidatePath("/admin");
  return {};
}

/**
 * Override a player's rating and reliability — SPEC.md §5.7.
 *
 * For when someone's self-assessment is plainly wrong: a 3.0 who is obviously a
 * 4.2, or a beginner who typed "5.0, 100% reliable". Recorded as a dated seed
 * event in history (source 'admin'), exactly like a signup seed or a monthly
 * re-seed, so the recompute picks it up and it can be undone by deleting it.
 *
 * Not subject to the 30-day self-service cooldown — that limit exists to stop a
 * player wiping their own bad streak, which isn't what this is for.
 */
export async function adjustRatingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireAdmin();

  const targetId = String(formData.get("playerId") ?? "");
  const rating = Number(String(formData.get("rating") ?? ""));
  const reliability = Number(String(formData.get("reliability") ?? "0"));
  const note = String(formData.get("note") ?? "").trim();

  if (!Number.isFinite(rating) || rating < RATING.MIN || rating > RATING.MAX) {
    return { error: `Rating must be between ${RATING.MIN} and ${RATING.MAX}.`, field: "rating" };
  }
  if (!Number.isFinite(reliability) || reliability < 0 || reliability > 100) {
    return { error: "Reliability must be between 0 and 100.", field: "reliability" };
  }

  const db = getDb();
  const rows = await db
    .select({ id: players.id, username: players.username })
    .from(players)
    .where(eq(players.id, targetId))
    .limit(1);

  const target = rows[0];
  if (!target) return { error: "That player no longer exists." };

  await db.insert(ratingSeeds).values({
    playerId: targetId,
    rating,
    declaredReliability: reliability,
    source: "admin",
    createdBy: me.id,
    note: note || null,
  });

  await recomputeAll();

  await db.insert(auditLog).values({
    actorId: me.id,
    action: "player.adjust_rating",
    targetType: "player",
    targetId,
    detail: `${target.username} -> ${rating.toFixed(3)} @ ${reliability}%${note ? ` (${note})` : ""}`,
  });

  revalidatePath("/admin");
  revalidatePath("/");
  return {};
}

/**
 * Reset a player's PIN — there is no email, so this is the only recovery path.
 *
 * Resetting a PIN is equivalent to taking over an account, so it follows the
 * role hierarchy strictly: an admin can reset a *player*, but only the super
 * admin can reset another admin. Without that rule any admin could reset a
 * peer's PIN, log in as them, and there would be no meaningful separation
 * between admin and super admin at all.
 *
 * Nobody can reset the super admin here — that would be a direct path to
 * owning the group. If Jason ever loses his PIN, recovery is a deliberate
 * database operation, not a button.
 */
export async function resetPinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAdmin();

  const targetId = String(formData.get("playerId") ?? "");
  const pin = String(formData.get("pin") ?? "").trim();

  const valid = validatePin(pin);
  if (!valid.ok) return { error: valid.error, field: "pin" };

  const db = getDb();
  const rows = await db
    .select({ id: players.id, username: players.username, role: players.role })
    .from(players)
    .where(eq(players.id, targetId))
    .limit(1);

  const target = rows[0];
  if (!target) return { error: "That player no longer exists." };

  if (target.role === "superadmin") {
    return { error: "The super admin's PIN can't be reset here." };
  }
  if (target.role === "admin" && me.role !== "superadmin") {
    return { error: "Only the super admin can reset another admin's PIN." };
  }

  await db.update(players).set({ pinHash: await hashPin(pin) }).where(eq(players.id, targetId));

  // Whoever was signed in as them is signed out.
  await revokeAllSessions(targetId);

  await db.insert(auditLog).values({
    actorId: me.id,
    action: "player.reset_pin",
    targetType: "player",
    targetId,
    detail: target.username,
  });

  revalidatePath("/admin");
  return {};
}

/**
 * Rebuild every rating from the full match history.
 *
 * Ratings are always derived (§5.6), so this is safe to run at any time and is
 * the fix for any suspected drift. Also the way freshly seeded players get
 * their stats row before they've played a match.
 *
 * Returns what it rebuilt: pressing a button that appears to do nothing is how
 * an admin ends up pressing it five more times.
 */
export async function recomputeAction(): Promise<RecomputeSummary> {
  const me = await requireAdmin();

  const summary = await recomputeAll();

  await getDb().insert(auditLog).values({
    actorId: me.id,
    action: "ratings.recompute",
    detail: `${summary.players} players, ${summary.matches} matches, ${summary.seeds} seeds`,
  });

  revalidatePath("/admin");
  revalidatePath("/");
  return summary;
}

"use server";

import { eq, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/permissions";
import { hashPin, validatePin } from "@/lib/auth/pin";
import { getT } from "@/lib/i18n/server";
import { canAdjustRating } from "@/lib/auth/policy";
import { revokeAllSessions } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { auditLog, matches, players, ratingSeeds } from "@/lib/db/schema";
import { generateInviteCode, setInviteCode } from "@/lib/invite";
import { RATING } from "@/lib/rating/constants";
import { recomputeAll, type RecomputeSummary } from "@/lib/rating/service";

export async function rotateInviteCodeAction(): Promise<void> {
  // Rotating invalidates the code for anyone part-way through signing up, so
  // it stays with the owner rather than with everyone holding an admin badge.
  const me = await requireSuperAdmin();

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
  const t = await getT(me.locale);

  const targetId = String(formData.get("playerId") ?? "");
  const nextRole = String(formData.get("role") ?? "");

  if (nextRole !== "player" && nextRole !== "admin") {
    return { error: t("err.badRole") };
  }
  if (targetId === me.id) {
    return { error: t("err.ownRole") };
  }

  const db = getDb();
  const rows = await db
    .select({ id: players.id, username: players.username, role: players.role })
    .from(players)
    .where(eq(players.id, targetId))
    .limit(1);

  const target = rows[0];
  if (!target) return { error: t("err.playerGone") };

  // There is exactly one superadmin and no UI creates another. Guard anyway, so
  // a crafted request can't demote the owner and orphan the group.
  if (target.role === "superadmin") {
    return { error: t("err.superadminRole") };
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
  const t = await getT(me.locale);

  const targetId = String(formData.get("playerId") ?? "");
  const rating = Number(String(formData.get("rating") ?? ""));
  const reliability = Number(String(formData.get("reliability") ?? "0"));
  const note = String(formData.get("note") ?? "").trim();

  if (!Number.isFinite(rating) || rating < RATING.MIN || rating > RATING.MAX) {
    return {
      error: t("err.ratingRange", { min: RATING.MIN, max: RATING.MAX }),
      field: "rating",
    };
  }
  if (!Number.isFinite(reliability) || reliability < 0 || reliability > 100) {
    return { error: t("err.reliabilityRange"), field: "reliability" };
  }

  const db = getDb();
  const rows = await db
    .select({ id: players.id, username: players.username, role: players.role })
    .from(players)
    .where(eq(players.id, targetId))
    .limit(1);

  const target = rows[0];
  if (!target) return { error: t("err.playerGone") };

  // Being an admin is not permission to rewrite another admin's rating.
  if (!canAdjustRating(me, { id: target.id, role: target.role })) {
    return {
      error:
        target.role === "superadmin"
          ? t("err.superadminRating")
          : t("err.adminRatingNeedsSuper"),
    };
  }

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
  const t = await getT(me.locale);

  const targetId = String(formData.get("playerId") ?? "");
  const pin = String(formData.get("pin") ?? "").trim();

  const valid = validatePin(pin);
  if (!valid.ok) return { error: t(valid.error), field: "pin" };

  const db = getDb();
  const rows = await db
    .select({ id: players.id, username: players.username, role: players.role })
    .from(players)
    .where(eq(players.id, targetId))
    .limit(1);

  const target = rows[0];
  if (!target) return { error: t("err.playerGone") };

  if (target.role === "superadmin") {
    return { error: t("err.superadminPin") };
  }
  if (target.role === "admin" && me.role !== "superadmin") {
    return { error: t("err.adminPinNeedsSuper") };
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
  const me = await requireSuperAdmin();

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

/**
 * Delete a duplicate account.
 *
 * The case this exists for: somebody forgets their PIN, signs up again, and
 * now the roster and the rankings carry a ghost. Super admin only.
 *
 * Refused once they have played, and deliberately so. Four columns of every
 * match point at players with no cascade, so the database would reject the
 * delete anyway — but a foreign-key error is a terrible way to learn that
 * removing this person would tear holes in three other people's records. We
 * check first and say why. A real duplicate has never played, so the case that
 * matters still works in one tap.
 */
export async function deletePlayerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireSuperAdmin();
  const t = await getT(me.locale);

  const targetId = String(formData.get("playerId") ?? "");
  if (targetId === me.id) return { error: t("err.deleteSelf") };

  const db = getDb();
  const rows = await db
    .select({ id: players.id, username: players.username, role: players.role })
    .from(players)
    .where(eq(players.id, targetId))
    .limit(1);

  const target = rows[0];
  if (!target) return { error: t("err.playerGone") };
  if (target.role === "superadmin") return { error: t("err.deleteSuperadmin") };

  const [{ played }] = await db
    .select({ played: sql<number>`count(*)::int` })
    .from(matches)
    .where(
      or(
        eq(matches.a1, targetId),
        eq(matches.a2, targetId),
        eq(matches.b1, targetId),
        eq(matches.b2, targetId),
      ),
    );

  if (played > 0) {
    return { error: t("err.deletePlayed", { name: target.username, count: played }) };
  }

  // Signups, seeds, stats, rating events and login tokens all cascade.
  await db.delete(players).where(eq(players.id, targetId));

  await db.insert(auditLog).values({
    actorId: me.id,
    action: "player.delete",
    targetType: "player",
    targetId,
    detail: target.username,
  });

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  return { ok: t("admin.deleted", { name: target.username }) };
}

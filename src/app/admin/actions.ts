"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/permissions";
import { revokeAllSessions } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { auditLog, players } from "@/lib/db/schema";
import { generateInviteCode, setInviteCode } from "@/lib/invite";

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

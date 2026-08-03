/**
 * Server-side permission enforcement — SPEC.md §3.
 *
 * Every helper throws rather than returning false. Server actions are public
 * HTTP endpoints: hiding a button in the UI is not a permission check, so
 * authorization must happen inside the action itself, and the safe failure for
 * a permission bug is an error rather than a silently allowed write.
 *
 * This module reaches into the session and therefore cannot be imported from a
 * client component. Import from ./policy for the pure predicates.
 */
import { getCurrentPlayer, type CurrentPlayer } from "./session";
import { isAtLeast, PermissionError } from "./policy";
import type { Role } from "./types";

export * from "./policy";

export async function requireLogin(): Promise<CurrentPlayer> {
  const me = await getCurrentPlayer();
  if (!me) throw new PermissionError("You need to be logged in.");
  return me;
}

export async function requireRole(minimum: Role): Promise<CurrentPlayer> {
  const me = await requireLogin();
  if (!isAtLeast(me.role, minimum)) throw new PermissionError();
  return me;
}

export const requireAdmin = () => requireRole("admin");
export const requireSuperAdmin = () => requireRole("superadmin");

/**
 * The permission policy — who may do what.
 *
 * Deliberately free of imports beyond types: this module has to be safe for
 * client components, server components, and plain unit tests alike. The
 * enforcement helpers that read the current session live in permissions.ts,
 * which cannot be imported from a client bundle.
 */
import type { Role } from "./types";

/** Higher rank implies every permission of the ranks below it. */
const RANK: Record<Role, number> = { player: 0, admin: 1, superadmin: 2 };

export const isAtLeast = (role: Role, minimum: Role) => RANK[role] >= RANK[minimum];

export const canManageSessions = (role: Role) => isAtLeast(role, "admin");
export const canManageInviteCode = (role: Role) => isAtLeast(role, "admin");
export const canEditAnyMatch = (role: Role) => isAtLeast(role, "admin");
/** Deliberately superadmin-only: one person decides who runs the group. */
export const canManageRoles = (role: Role) => isAtLeast(role, "superadmin");

export class PermissionError extends Error {
  constructor(message = "Not authorized.") {
    super(message);
    this.name = "PermissionError";
  }
}

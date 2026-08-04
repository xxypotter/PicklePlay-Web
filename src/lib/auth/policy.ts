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

/** May create sessions at all. Says nothing about *whose* sessions. */
export const canManageSessions = (role: Role) => isAtLeast(role, "admin");
export const canManageInviteCode = (role: Role) => isAtLeast(role, "admin");
/** Deliberately superadmin-only: one person decides who runs the group. */
export const canManageRoles = (role: Role) => isAtLeast(role, "superadmin");

// ---------------------------------------------------------------------------
// Session-scoped permissions
// ---------------------------------------------------------------------------

/** Just enough of a session to decide who may act on it. */
export interface SessionScope {
  createdBy: string | null;
  status: "draft" | "open" | "live" | "closed";
}

export interface Actor {
  id: string;
  role: Role;
}

/**
 * Who may run a session: its details, its roster, its rounds, ending it,
 * deleting it.
 *
 * Organizing a session — not holding the admin role — is what grants control
 * over it. With two admins a blanket "admins manage sessions" rule is merely
 * untidy; with ten it means anyone can restart someone else's night, rebuild
 * their schedule, or delete it out from under them. Ownership scopes that back
 * to the person actually running the game.
 *
 * The superadmin is the deliberate exception, so somebody can always step in
 * when an organizer is unreachable. A session whose creator has been deleted
 * (createdBy goes null) likewise falls to the superadmin rather than to
 * everyone.
 */
export const canOrganizeSession = (actor: Actor, session: SessionScope): boolean =>
  isAtLeast(actor.role, "superadmin") ||
  (isAtLeast(actor.role, "admin") &&
    session.createdBy !== null &&
    session.createdBy === actor.id);

/**
 * Who may record or change a score.
 *
 * While a night is running, whoever is on court needs to enter the number, and
 * any admin present should be able to help — waiting for the organizer to walk
 * over is how scores get lost. Once the session is closed the result stops
 * being a live scoreboard and becomes a record, so amending it narrows to the
 * organizer.
 */
export const canScoreMatch = (
  actor: Actor,
  session: SessionScope,
  playedInIt: boolean,
): boolean =>
  session.status === "closed"
    ? canOrganizeSession(actor, session)
    : playedInIt || isAtLeast(actor.role, "admin");

export class PermissionError extends Error {
  constructor(message = "Not authorized.") {
    super(message);
    this.name = "PermissionError";
  }
}

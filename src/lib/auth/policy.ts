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
/** Seeing the code and sharing it around — the everyday case. */
export const canManageInviteCode = (role: Role) => isAtLeast(role, "admin");
/** Deliberately superadmin-only: one person decides who runs the group. */
export const canManageRoles = (role: Role) => isAtLeast(role, "superadmin");

/*
 * Three controls that act on the whole group at once rather than on one
 * session or one player, so they sit with the owner rather than with everyone
 * holding an admin badge.
 */

/** Rotating the code invalidates it for anyone mid-signup. */
export const canRotateInviteCode = (role: Role) => isAtLeast(role, "superadmin");
/** A rebuild moves every rating in the group in one press. */
export const canRecomputeRatings = (role: Role) => isAtLeast(role, "superadmin");
/** These controls also reveal whether the deploy is holding credentials. */
export const canRunBackup = (role: Role) => isAtLeast(role, "superadmin");

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

/**
 * Who may overwrite someone's rating.
 *
 * An admin may correct a player's number, and their own. They may not touch a
 * peer's, and certainly not the superadmin's. The rating is the thing this app
 * exists to keep honest; admins able to rewrite each other's turns every
 * disagreement into an edit war with no referee, and an admin able to rewrite
 * the superadmin's has quietly outranked them.
 *
 * Same shape as resetPinAction's rule, for the same reason — both are ways to
 * reach past your own level.
 */
export const canAdjustRating = (
  actor: Actor,
  target: { id: string; role: Role },
): boolean => {
  if (isAtLeast(actor.role, "superadmin")) return true;
  if (!isAtLeast(actor.role, "admin")) return false;
  return target.id === actor.id || target.role === "player";
};

export class PermissionError extends Error {
  constructor(message = "Not authorized.") {
    super(message);
    this.name = "PermissionError";
  }
}

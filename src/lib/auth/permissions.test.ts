/**
 * The permission matrix, asserted directly.
 *
 * Hiding a button is not a permission check — server actions are public HTTP
 * endpoints. These tests pin the policy itself; each action additionally calls
 * requireRole() as its first statement so an unauthorized caller throws before
 * touching the database.
 */
import { describe, expect, it } from "vitest";
import {
  canManageInviteCode,
  canManageRoles,
  canManageSessions,
  canOrganizeSession,
  canScoreMatch,
  isAtLeast,
  type SessionScope,
} from "./policy";
import type { Role } from "./types";

const ROLES: Role[] = ["player", "admin", "superadmin"];

describe("role hierarchy", () => {
  it("is strictly ordered", () => {
    expect(isAtLeast("superadmin", "admin")).toBe(true);
    expect(isAtLeast("admin", "player")).toBe(true);
    expect(isAtLeast("admin", "superadmin")).toBe(false);
    expect(isAtLeast("player", "admin")).toBe(false);
  });

  it("makes every role satisfy itself", () => {
    for (const r of ROLES) expect(isAtLeast(r, r)).toBe(true);
  });
});

describe("what each role may do", () => {
  it("lets admins and above run the group", () => {
    for (const check of [canManageSessions, canManageInviteCode]) {
      expect(check("player")).toBe(false);
      expect(check("admin")).toBe(true);
      expect(check("superadmin")).toBe(true);
    }
  });

  it("restricts granting and removing admin to the super admin alone", () => {
    expect(canManageRoles("player")).toBe(false);
    // The whole point: an admin cannot mint more admins, so "one person decides
    // who runs the group" stays true after the first promotion.
    expect(canManageRoles("admin")).toBe(false);
    expect(canManageRoles("superadmin")).toBe(true);
  });

  it("gives a plain player no management rights at all", () => {
    const checks = [canManageSessions, canManageInviteCode, canManageRoles];
    expect(checks.every((c) => c("player") === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session-scoped permissions
// ---------------------------------------------------------------------------

const OWNER = { id: "owner", role: "admin" as Role };
const OTHER_ADMIN = { id: "other", role: "admin" as Role };
const SUPER = { id: "boss", role: "superadmin" as Role };
const PLAYER = { id: "pat", role: "player" as Role };

const session = (status: SessionScope["status"], createdBy: string | null = "owner") =>
  ({ createdBy, status }) as SessionScope;

describe("who may organize a session", () => {
  it("lets the admin who created it run it", () => {
    for (const s of ["open", "live", "closed"] as const) {
      expect(canOrganizeSession(OWNER, session(s))).toBe(true);
    }
  });

  it("keeps other admins out of someone else's session", () => {
    // The point of the whole change: with many admins, a blanket admin check
    // means anyone can restart or delete a night they have nothing to do with.
    for (const s of ["open", "live", "closed"] as const) {
      expect(canOrganizeSession(OTHER_ADMIN, session(s))).toBe(false);
    }
  });

  it("lets the superadmin run anyone's session", () => {
    for (const s of ["open", "live", "closed"] as const) {
      expect(canOrganizeSession(SUPER, session(s))).toBe(true);
    }
  });

  it("never lets a plain player organize, even their own", () => {
    expect(canOrganizeSession(PLAYER, session("open", "pat"))).toBe(false);
  });

  it("falls back to the superadmin when the creator is gone", () => {
    // createdBy goes null if the account is deleted; that must not open the
    // session up to every admin.
    expect(canOrganizeSession(OTHER_ADMIN, session("open", null))).toBe(false);
    expect(canOrganizeSession(OWNER, session("open", null))).toBe(false);
    expect(canOrganizeSession(SUPER, session("open", null))).toBe(true);
  });
});

describe("who may score a match", () => {
  it("lets a participant score while the session is live", () => {
    expect(canScoreMatch(PLAYER, session("live"), true)).toBe(true);
  });

  it("refuses a player who wasn't in the match", () => {
    expect(canScoreMatch(PLAYER, session("live"), false)).toBe(false);
  });

  it("lets any admin help out while the session is live", () => {
    expect(canScoreMatch(OTHER_ADMIN, session("live"), false)).toBe(true);
    expect(canScoreMatch(OWNER, session("live"), false)).toBe(true);
  });

  it("narrows to the organizer once the session is closed", () => {
    // A finished night is a record, not a scoreboard.
    expect(canScoreMatch(PLAYER, session("closed"), true)).toBe(false);
    expect(canScoreMatch(OTHER_ADMIN, session("closed"), false)).toBe(false);
    expect(canScoreMatch(OWNER, session("closed"), false)).toBe(true);
    expect(canScoreMatch(SUPER, session("closed"), false)).toBe(true);
  });

  it("still lets participants score a session that hasn't started", () => {
    expect(canScoreMatch(PLAYER, session("open"), true)).toBe(true);
  });
});

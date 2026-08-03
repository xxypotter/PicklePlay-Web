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
  canEditAnyMatch,
  canManageInviteCode,
  canManageRoles,
  canManageSessions,
  isAtLeast,
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
    for (const check of [canManageSessions, canManageInviteCode, canEditAnyMatch]) {
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
    const checks = [canManageSessions, canManageInviteCode, canEditAnyMatch, canManageRoles];
    expect(checks.every((c) => c("player") === false)).toBe(true);
  });
});

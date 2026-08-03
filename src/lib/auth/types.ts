/**
 * Shared auth types.
 *
 * Kept out of actions.ts because a "use server" module may only export async
 * functions, and out of permissions.ts/session.ts because those import each
 * other and would form a cycle.
 */

export type Role = "player" | "admin" | "superadmin";

/**
 * Display labels live here, not in permissions.ts, because client components
 * need them — and permissions.ts reaches into session.ts, which uses
 * next/headers and therefore cannot be pulled into a client bundle.
 */
export const ROLE_LABELS: Record<Role, string> = {
  player: "Player",
  admin: "Admin",
  superadmin: "Super admin",
};

export interface FormState {
  error?: string;
  /** Which field to focus, so mobile users aren't hunting for the problem. */
  field?: string;
}

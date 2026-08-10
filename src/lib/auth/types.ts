/**
 * Shared auth types.
 *
 * Kept out of actions.ts because a "use server" module may only export async
 * functions, and out of permissions.ts/session.ts because those import each
 * other and would form a cycle.
 */

export type Role = "player" | "admin" | "superadmin";

/*
 * The display labels used to live here. They're `role.player` and friends in
 * the dictionary now, so a role reads in whatever language the viewer chose.
 */

export interface FormState {
  error?: string;
  /** Which field to focus, so mobile users aren't hunting for the problem. */
  field?: string;
  /** Confirmation for an action whose success isn't visible on screen. */
  ok?: string;
}

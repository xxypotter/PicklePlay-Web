/**
 * Kept out of actions.ts because a "use server" module may only export async
 * functions — a type export there is a build error waiting to happen.
 */
export interface FormState {
  error?: string;
  /** Which field to focus, so mobile users aren't hunting for the problem. */
  field?: string;
}

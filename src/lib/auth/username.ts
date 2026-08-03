/**
 * Username rules — SPEC.md §4.1.
 *
 * First to register a name owns it. Uniqueness is case-insensitive so `MikeD`
 * and `miked` can't both exist, and the failure message never reveals who holds
 * a name.
 */

const PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,19}$/;

const RESERVED = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "api",
  "null",
  "undefined",
  "me",
  "you",
  "pickleplay",
  "ppr",
  "dupr",
]);

/** The form uniqueness is enforced on. Always store alongside the typed form. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(
  username: string,
): { ok: true; username: string; normalized: string } | { ok: false; error: string } {
  const trimmed = username.trim();

  if (trimmed.length < 3) {
    return { ok: false, error: "Name must be at least 3 characters." };
  }
  if (trimmed.length > 20) {
    return { ok: false, error: "Name must be 20 characters or fewer." };
  }
  if (!PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: "Use letters, numbers, hyphens, and underscores only, starting with a letter or number.",
    };
  }

  const normalized = normalizeUsername(trimmed);
  if (RESERVED.has(normalized)) {
    return { ok: false, error: "That name is reserved. Try another." };
  }

  return { ok: true, username: trimmed, normalized };
}

/** Shown when a name is taken. Deliberately says nothing about who has it. */
export const NAME_TAKEN_MESSAGE = "That name is taken. Try another.";

/**
 * Username rules — SPEC.md §4.1.
 *
 * First to register a name owns it. Uniqueness is case-insensitive so `MikeD`
 * and `miked` can't both exist, and the failure message never reveals who holds
 * a name.
 */

import type { DictKey } from "@/lib/i18n/dictionaries/en";

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
): { ok: true; username: string; normalized: string } | { ok: false; error: DictKey } {
  const trimmed = username.trim();

  if (trimmed.length < 3) {
    return { ok: false, error: "err.nameShort" };
  }
  if (trimmed.length > 20) {
    return { ok: false, error: "err.nameLong" };
  }
  if (!PATTERN.test(trimmed)) {
    return { ok: false, error: "err.nameChars" };
  }

  const normalized = normalizeUsername(trimmed);
  if (RESERVED.has(normalized)) {
    return { ok: false, error: "err.nameReserved" };
  }

  return { ok: true, username: trimmed, normalized };
}

/** Shown when a name is taken. Deliberately says nothing about who has it. */
export const NAME_TAKEN_KEY: DictKey = "err.nameTaken";

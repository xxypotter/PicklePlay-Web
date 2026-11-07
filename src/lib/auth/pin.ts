/**
 * PIN hashing.
 *
 * Uses Node's built-in scrypt rather than Argon2id (which SPEC.md §9 originally
 * named). Argon2 needs a native module, and native modules are the most common
 * way a Vercel deploy breaks at runtime rather than at build time. scrypt is a
 * memory-hard KDF built into Node with zero dependencies and no deploy risk.
 *
 * The real defense for a 4-6 digit PIN is the login rate limit (§9) — 10,000
 * combinations falls to any KDF given unlimited attempts, and holds up under
 * every KDF given five attempts per fifteen minutes.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LEN = 64;
const SALT_LEN = 16;

/** Encoded as `scrypt$N$r$p$salt$key`, so parameters can be raised later. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(pin.normalize("NFKC"), salt, KEY_LEN, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  const params = { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem };
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) {
    return false;
  }

  const actual = await scrypt(pin.normalize("NFKC"), salt, expected.length, params);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * 4–6 digits, nothing more — at signup and on an admin reset alike.
 *
 * There used to be a "too easy to guess" rule (no 1111, no 1234). It cost more
 * than it was worth: an admin resetting a forgotten PIN reaches for exactly
 * those, and twice the refusal went unseen and a player was told a PIN that
 * was never saved (BoRong 2026-10-02, ProfWu 2026-11-07). Removed at the
 * owner's request on 2026-11-07. The rate limit is what protects a PIN here,
 * not its digits.
 */
export function validatePin(pin: string): { ok: true } | { ok: false; error: DictKey } {
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "err.pinDigits" };
  return { ok: true };
}

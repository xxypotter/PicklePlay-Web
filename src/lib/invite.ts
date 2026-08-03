/**
 * Group invite code.
 *
 * The app lives on a public URL, so registration needs a gate or strangers end
 * up on the leaderboard. One shared code that the organizer posts in the group
 * chat is the lightest thing that works, and rotating it instantly stops new
 * signups without touching a single existing account.
 *
 * Fails CLOSED: if no code is configured and anyone is already registered,
 * registration is refused rather than left open.
 */
import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { settings } from "@/lib/db/schema";

const KEY = "invite_code";

/** No 0/O/1/I/L — these get typed wrong on a phone at a noisy gym. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 6;

export function generateInviteCode(): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Case- and space-insensitive, so "k7p 2wm" still works. */
export function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export async function getInviteCode(): Promise<string | null> {
  const rows = await getDb()
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, KEY))
    .limit(1);

  return rows[0]?.value ?? process.env.GROUP_INVITE_CODE ?? null;
}

export async function setInviteCode(code: string, actorId: string): Promise<string> {
  const value = normalizeCode(code);
  await getDb()
    .insert(settings)
    .values({ key: KEY, value, updatedBy: actorId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: actorId, updatedAt: new Date() },
    });
  return value;
}

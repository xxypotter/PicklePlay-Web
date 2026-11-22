/**
 * Login sessions — SPEC.md §9.
 *
 * An opaque 256-bit random token lives in an HttpOnly cookie; only its HMAC is
 * stored. A database leak therefore yields no usable sessions, and rotating
 * SESSION_SECRET logs everyone out — which is the behavior you want from a
 * secret rotation.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { getDb } from "@/lib/db";
import { authTokens, players } from "@/lib/db/schema";
import type { Role } from "./types";

const COOKIE_NAME = "pp_session";
const TTL_DAYS = 90;
/*
 * Sliding sign-in (v2.3). A fixed 90-day token signed everyone out on day 90,
 * and every PIN reset in November landed on day 90–105 of the account. Now a
 * visit renews it for another 90 days, at most once a day (anything older than
 * a day gets renewed), so you stay signed in as long as you open the app at
 * least once every three months. What protects a PIN is the sign-in budget in
 * rate-limit.ts (five tries per name per 15 minutes; 30 per 15 minutes and 60
 * a day across real names), not the token's lifetime.
 */
const RENEW_WHEN_OLDER_THAN_MS = 86_400_000;

/*
 * "This browser has signed in as this player before" (v2.3). Set on every
 * sign-in and renewal, signed with SESSION_SECRET so it cannot be forged, and
 * kept far longer than a session (browsers cap cookies at about 400 days). The
 * group-wide sign-in budget exempts it (rate-limit.ts), so a deliberate flood
 * of wrong PINs cannot keep a regular out on their own phone. One player per
 * browser: the last one to sign in.
 */
const DEVICE_COOKIE = "pp_device";
const DEVICE_DAYS = 400;

function tokenHash(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return createHmac("sha256", secret).update(token).digest("hex");
}

export interface CurrentPlayer {
  id: string;
  username: string;
  displayName: string | null;
  role: Role;
  /** Chosen language, or null if they've never picked one. */
  locale: string | null;
  /** The sign-in is more than a day old; the layout renews it (SessionRenewer). */
  renewDue: boolean;
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

function deviceSignature(playerId: string): string {
  return tokenHash(`device:${playerId}`);
}

async function markKnownDevice(playerId: string): Promise<void> {
  const jar = await cookies();
  jar.set(DEVICE_COOKIE, `${playerId}.${deviceSignature(playerId)}`,
    cookieOptions(new Date(Date.now() + DEVICE_DAYS * 86_400_000)));
}

/** True when this browser has signed in as `playerId` before. */
export async function isKnownDevice(playerId: string): Promise<boolean> {
  const value = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 0 || value.slice(0, dot) !== playerId) return false;
  return safeEqual(value.slice(dot + 1), deviceSignature(playerId));
}

export async function createSession(playerId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);

  await getDb().insert(authTokens).values({ tokenHash: tokenHash(token), playerId, expiresAt });

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, cookieOptions(expiresAt));
  await markKnownDevice(playerId);
}

/** When a token that expires at `expiresAt` should next be renewed. */
const renewDueFor = (expiresAt: Date) =>
  expiresAt.getTime() - Date.now() < TTL_DAYS * 86_400_000 - RENEW_WHEN_OLDER_THAN_MS;

/**
 * Push the current sign-in out to a fresh 90 days. Only from a Server Action:
 * cookies cannot be set while a Server Component renders. Extends only a token
 * that is still valid and belongs to an active player, so it can never revive
 * a revoked or expired sign-in.
 */
export async function renewSession(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return false;

  const me = await getCurrentPlayer();
  if (!me) return false;

  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);
  const updated = await getDb()
    .update(authTokens)
    .set({ expiresAt })
    .where(and(eq(authTokens.tokenHash, tokenHash(token)), gt(authTokens.expiresAt, new Date())))
    .returning({ id: authTokens.id });
  if (!updated.length) return false;

  jar.set(COOKIE_NAME, token, cookieOptions(expiresAt));
  // Players signed in before v2.3 get the device mark on their first renewal.
  await markKnownDevice(me.id);
  return true;
}

/**
 * Returns null when logged out. Safe to call from any server component.
 *
 * Memoized for the life of one request: the layout, the page and its
 * generateMetadata all want the signed-in player, and without this that is
 * three identical round trips to answer the same question.
 */
export const getCurrentPlayer = cache(async (): Promise<CurrentPlayer | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await getDb()
    .select({
      id: players.id,
      username: players.username,
      displayName: players.displayName,
      role: players.role,
      locale: players.locale,
      active: players.active,
      expiresAt: authTokens.expiresAt,
    })
    .from(authTokens)
    .innerJoin(players, eq(players.id, authTokens.playerId))
    .where(and(eq(authTokens.tokenHash, tokenHash(token)), gt(authTokens.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row || !row.active) return null;

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    locale: row.locale,
    renewDue: renewDueFor(row.expiresAt),
  };
});

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;

  if (token) {
    await getDb().delete(authTokens).where(eq(authTokens.tokenHash, tokenHash(token)));
  }
  jar.delete(COOKIE_NAME);
}

/** Invalidate every session for a player — used on admin PIN reset. */
export async function revokeAllSessions(playerId: string): Promise<void> {
  await getDb().delete(authTokens).where(eq(authTokens.playerId, playerId));
}

/** Constant-time compare for anything else that needs it. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

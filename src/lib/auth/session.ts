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
import { getDb } from "@/lib/db";
import { authTokens, players } from "@/lib/db/schema";

const COOKIE_NAME = "pp_session";
const TTL_DAYS = 90;

function tokenHash(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return createHmac("sha256", secret).update(token).digest("hex");
}

export interface CurrentPlayer {
  id: string;
  username: string;
  displayName: string | null;
  role: "player" | "organizer" | "admin";
}

export async function createSession(playerId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);

  await getDb().insert(authTokens).values({ tokenHash: tokenHash(token), playerId, expiresAt });

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Returns null when logged out. Safe to call from any server component. */
export async function getCurrentPlayer(): Promise<CurrentPlayer | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await getDb()
    .select({
      id: players.id,
      username: players.username,
      displayName: players.displayName,
      role: players.role,
      active: players.active,
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
  };
}

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

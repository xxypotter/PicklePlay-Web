/**
 * Login rate limiting — SPEC.md §9.
 *
 * This is the control that actually makes a 4-digit PIN safe. 10,000
 * combinations falls to any hash function given unlimited attempts and holds up
 * under every hash function given five attempts per fifteen minutes.
 *
 * Keyed on username rather than IP: the attack we care about is guessing one
 * person's PIN, and IPs are shared (everyone at the same courts is on the same
 * wifi) as well as trivially rotated.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { loginAttempts } from "@/lib/db/schema";

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

export interface RateLimitResult {
  allowed: boolean;
  /** Minutes until the next attempt is permitted; only set when blocked. */
  retryAfterMinutes?: number;
}

export async function checkLoginRate(usernameLower: string): Promise<RateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

  const rows = await getDb()
    .select({
      failures: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${loginAttempts.attemptedAt})`,
    })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.usernameLower, usernameLower),
        eq(loginAttempts.succeeded, false),
        gte(loginAttempts.attemptedAt, since),
      ),
    );

  const { failures, oldest } = rows[0] ?? { failures: 0, oldest: null };
  if (failures < MAX_FAILURES) return { allowed: true };

  // Unblocks as the oldest failure ages out of the window, rather than resetting
  // the full 15 minutes on every rejected attempt.
  const unblockAt = new Date(new Date(oldest ?? since).getTime() + WINDOW_MINUTES * 60_000);
  const minutes = Math.max(1, Math.ceil((unblockAt.getTime() - Date.now()) / 60_000));

  return { allowed: false, retryAfterMinutes: minutes };
}

export async function recordLoginAttempt(
  usernameLower: string,
  succeeded: boolean,
): Promise<void> {
  const db = getDb();
  await db.insert(loginAttempts).values({ usernameLower, succeeded });

  // A correct PIN clears the slate, so one forgetful evening doesn't lock
  // someone out for the rest of it.
  if (succeeded) {
    await db.delete(loginAttempts).where(eq(loginAttempts.usernameLower, usernameLower));
  }
}

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
import { auditLog, loginAttempts } from "@/lib/db/schema";

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;
/*
 * Group-wide cap (v2.3). Since any 4–6 digits is a valid PIN, someone could try
 * 1111 against every name at five tries each. Real traffic is tiny — eight
 * failed sign-ins in the whole of November — so thirty failures across all
 * names in fifteen minutes is never a busy session start; it is someone
 * guessing, and sign-ins pause until the window clears.
 */
const GLOBAL_MAX_FAILURES = 30;

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

/**
 * The group-wide check. When it trips, one audit row per window records it
 * (actor null: nobody in particular did it) so the owner can see it happened.
 */
export async function checkGlobalLoginRate(): Promise<RateLimitResult> {
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

  const [{ failures }] = await db
    .select({ failures: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.succeeded, false), gte(loginAttempts.attemptedAt, since)));

  if (failures < GLOBAL_MAX_FAILURES) return { allowed: true };

  const logged = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.action, "auth.busy"), gte(auditLog.createdAt, since)))
    .limit(1);
  if (!logged.length) {
    await db.insert(auditLog).values({
      actorId: null,
      action: "auth.busy",
      detail: JSON.stringify({ failures, windowMinutes: WINDOW_MINUTES }),
    });
  }
  return { allowed: false, retryAfterMinutes: WINDOW_MINUTES };
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

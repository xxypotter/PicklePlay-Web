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
 *
 * v2.3 adds a group-wide budget, because any 4–6 digits is now a valid PIN and
 * someone could try 1111 against every name on the public Rankings page:
 *
 * - **Reserve, then check the PIN.** Each attempt is recorded as a failure up
 *   front, under one advisory lock, before the scrypt check; a correct PIN then
 *   clears the name's rows. Counting first and recording after let a burst of
 *   simultaneous requests all read "under the limit" before any of them landed.
 * - **Only real usernames count** toward the group budget. A typo or someone
 *   typing their real name can never be a successful guess, and those were most
 *   of November's failures.
 * - **Two windows:** 30 failures in 15 minutes, or 60 in a day. Real traffic is
 *   about eight failures a month.
 * - **A phone that has signed in as that player before is exempt** (a signed
 *   device cookie, session.ts), so someone deliberately tripping the budget
 *   cannot keep the regulars out; it pauses only sign-ins from browsers we have
 *   not seen that player use. Signed-in actions such as Change PIN skip the
 *   group check entirely: a session is not something a guesser has.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, loginAttempts, players } from "@/lib/db/schema";
import { inTransaction } from "@/lib/db/transaction";

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;
const GLOBAL_MAX_FAILURES = 30;
const GLOBAL_DAY_MAX_FAILURES = 60;
/** Serializes the reserve step; any constant distinct from the recompute lock (72417001). */
const LOGIN_LOCK = 72417002;

export interface RateLimitResult {
  allowed: boolean;
  /** Minutes until the next attempt is permitted; only set when blocked. */
  retryAfterMinutes?: number;
}

export type Reservation =
  | { ok: true }
  | { ok: false; reason: "name" | "busy"; retryAfterMinutes: number };

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

  return limitFrom(rows[0], since);
}

function limitFrom(row: { failures: number; oldest: Date | null } | undefined, since: Date): RateLimitResult {
  const { failures, oldest } = row ?? { failures: 0, oldest: null };
  if (failures < MAX_FAILURES) return { allowed: true };

  // Unblocks as the oldest failure ages out of the window, rather than resetting
  // the full 15 minutes on every rejected attempt.
  const unblockAt = new Date(new Date(oldest ?? since).getTime() + WINDOW_MINUTES * 60_000);
  const minutes = Math.max(1, Math.ceil((unblockAt.getTime() - Date.now()) / 60_000));

  return { allowed: false, retryAfterMinutes: minutes };
}

/**
 * Reserve one sign-in attempt for `usernameLower`, before the PIN is checked.
 *
 * Refuses with "name" when that name has used its five tries, or with "busy"
 * when `groupCheck` is on and the group budget is spent (one `auth.busy` audit
 * row per window records it). Otherwise records a failed attempt and returns
 * ok; the caller clears it with recordLoginAttempt(name, true) on success.
 */
export async function reserveLoginAttempt(
  usernameLower: string,
  { groupCheck }: { groupCheck: boolean },
): Promise<Reservation> {
  return inTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOGIN_LOCK})`);
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

    const [mine] = await tx
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
    const limit = limitFrom(mine, since);
    if (!limit.allowed) return { ok: false, reason: "name", retryAfterMinutes: limit.retryAfterMinutes ?? 1 };

    if (groupCheck) {
      const day = new Date(Date.now() - 86_400_000);
      // Real usernames only: a name nobody has can never be a successful guess.
      const [group] = await tx
        .select({
          recent: sql<number>`count(*) filter (where ${loginAttempts.attemptedAt} >= ${since})::int`,
          today: sql<number>`count(*)::int`,
        })
        .from(loginAttempts)
        .innerJoin(players, eq(players.usernameLower, loginAttempts.usernameLower))
        .where(and(eq(loginAttempts.succeeded, false), gte(loginAttempts.attemptedAt, day)));

      if (group.recent >= GLOBAL_MAX_FAILURES || group.today >= GLOBAL_DAY_MAX_FAILURES) {
        const logged = await tx
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(and(eq(auditLog.action, "auth.busy"), gte(auditLog.createdAt, since)))
          .limit(1);
        if (!logged.length) {
          await tx.insert(auditLog).values({
            actorId: null,
            action: "auth.busy",
            detail: JSON.stringify({ last15Minutes: group.recent, last24Hours: group.today }),
          });
        }
        return { ok: false, reason: "busy", retryAfterMinutes: WINDOW_MINUTES };
      }
    }

    await tx.insert(loginAttempts).values({ usernameLower, succeeded: false });
    return { ok: true };
  });
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

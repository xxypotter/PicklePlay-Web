import { lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { authTokens, loginAttempts } from "@/lib/db/schema";

/** Login attempts matter for the 15-minute rate limit; a week is ample history. */
const ATTEMPTS_KEEP_DAYS = 7;

/**
 * Delete what the login system no longer reads.
 *
 * An expired token is already refused by every lookup, and a login attempt
 * only ever counts inside its fifteen-minute window — but neither was ever
 * removed, so both tables grew for as long as the app ran. Run from the weekly
 * cron, which already exists for the backup; nothing here needs its own clock.
 */
export async function pruneAuthTables(): Promise<{ tokens: number; attempts: number }> {
  const db = getDb();
  const tokens = await db.delete(authTokens).where(lt(authTokens.expiresAt, new Date())).returning({ id: authTokens.id });
  const attempts = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, new Date(Date.now() - ATTEMPTS_KEEP_DAYS * 86_400_000)))
    .returning({ id: loginAttempts.id });
  return { tokens: tokens.length, attempts: attempts.length };
}

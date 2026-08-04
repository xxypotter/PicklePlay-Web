import { and, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";

/** A night is over long before this; the window is generous on purpose. */
export const AUTO_CLOSE_HOURS = 24;

/**
 * Close sessions nobody remembered to end.
 *
 * Organizers finish a night, put their phone away, and never tap End. Without
 * this those sessions sit in Upcoming forever, and stale ones would crowd out
 * the next real game.
 *
 * A single conditional UPDATE, so it's idempotent and normally touches nothing.
 * Called on page loads for immediacy and from the daily cron as a backstop for
 * when nobody opens the app at all.
 */
export async function closeStaleSessions(): Promise<number> {
  const result = await getDb()
    .update(sessions)
    .set({ status: "closed" })
    .where(
      and(
        ne(sessions.status, "closed"),
        lt(sessions.startsAt, sql`now() - interval '${sql.raw(String(AUTO_CLOSE_HOURS))} hours'`),
      ),
    )
    .returning({ id: sessions.id });

  return result.length;
}

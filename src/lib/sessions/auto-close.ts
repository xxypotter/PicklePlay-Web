import { and, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";

/**
 * How long a session may sit unfinished before it closes itself.
 *
 * A night is over long before this; the window is generous on purpose. Raised
 * from 24 to 48 so a Saturday evening that runs late, or an organizer who only
 * picks their phone up the next day, still gets to end it themselves — closing
 * locks scoring down to the organizer, so an early auto-close takes the pen out
 * of the hands of everyone who was on court.
 */
export const AUTO_CLOSE_HOURS = 48;

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

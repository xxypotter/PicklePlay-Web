/**
 * Roster bookkeeping shared by the session actions.
 *
 * Not a "use server" module: these are helpers that run inside a caller's
 * transaction, and a "use server" file turns every export into a public
 * endpoint. They live here so the edit action can promote the waitlist the
 * same way the roster actions do.
 */
import { sql } from "drizzle-orm";
import type { Transaction } from "@/lib/db/transaction";
import { signups } from "@/lib/db/schema";

/**
 * How many of a session's places are actually taken.
 *
 * Counts people who are confirmed *and* expected to play. Before the night
 * those are the same set, because `attended` defaults to true — the two only
 * diverge once an organizer marks a no-show, and at that moment the place
 * genuinely is free.
 *
 * Counting raw signups instead is what made the play console lie: a player who
 * never turned up kept their seat, so tapping "+ walk-in" silently filed them
 * on the waitlist and they were never scheduled.
 */
export const occupiedPlaces = (sessionId: string) => sql`(
  select count(*) from ${signups}
  where session_id = ${sessionId}::uuid and state = 'in' and attended = true
)`;

/** Move waiting players into free places, in the order they joined. */
export async function promote(db: Transaction, id: string, cap: number) {
  await db.execute(sql`update ${signups} set state='in',waitlist_pos=null where id in
    (select id from ${signups} where session_id=${id}::uuid and state='waitlist' order by created_at,id
    limit greatest(0,${cap}-${occupiedPlaces(id)}))`);
}

/** Renumber the waitlist 1..n after any change to it. */
export async function resequence(db: Transaction, id: string) {
  await db.execute(sql`update ${signups} s set waitlist_pos=ranked.pos from
    (select id,row_number() over(order by created_at,id) as pos from ${signups}
    where session_id=${id}::uuid and state='waitlist') ranked where s.id=ranked.id`);
}

/** Break a player's fixed pair, on both rows. */
export async function detach(db: Transaction, id: string, playerId: string) {
  await db.execute(sql`update ${signups} set partner_id=null where session_id=${id}::uuid
    and (player_id=${playerId}::uuid or partner_id=${playerId}::uuid)`);
}

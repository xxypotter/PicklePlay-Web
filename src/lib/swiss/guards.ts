import { eq } from "drizzle-orm";
import type { Transaction } from "@/lib/db/transaction";
import { matches, rounds, sessions } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";

/**
 * Don't let a result change underneath a stage that was drawn from it.
 *
 * The playoffs are seeded from the Swiss standings, and the finals from the
 * semi-finals. Changing an earlier result once the next stage exists would
 * leave pairs playing for places they no longer earned, so it is refused until
 * the organizer discards the unplayed later round. Within the Swiss rounds a
 * correction is allowed: rounds already drawn stay as drawn, as in any Swiss
 * event, and the standings simply update.
 */
export async function guardSwissResultChange(db: Transaction, match: typeof matches.$inferSelect) {
  if (!match.sessionId || !match.roundId) return;
  const [session] = await db.select({ format: sessions.format }).from(sessions).where(eq(sessions.id, match.sessionId));
  if (session?.format !== "swiss") return;
  const stages = await db.select({ id: rounds.id, stage: rounds.stage }).from(rounds).where(eq(rounds.sessionId, match.sessionId));
  const stage = stages.find((r) => r.id === match.roundId)?.stage;
  const later = stage === "robin"
    ? stages.some((r) => r.stage !== "robin")
    : stage === "semifinal" && stages.some((r) => r.stage === "final");
  if (later) throw new Error((await getT())("swiss.error.downstream"));
}

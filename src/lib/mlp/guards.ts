import { and, eq, ne } from "drizzle-orm";
import { matches, mlpTies, rounds, sessions } from "@/lib/db/schema";
import type { Transaction } from "@/lib/db/transaction";
import { getT } from "@/lib/i18n/server";

/** Called under the same session lock as schedule creation and score changes. */
export async function requireMutableRoster(db: Transaction, sessionId: string) {
  const [session]=await db.select().from(sessions).where(eq(sessions.id,sessionId));
  const t=await getT();
  if(!session) throw new Error(t("err.sessionGone"));
  if(session.status==="closed") throw new Error(t("err.sessionClosed"));
  if(session.format==="mlp") {
    const existing=await db.select({id:rounds.id}).from(rounds).where(eq(rounds.sessionId,sessionId)).limit(1);
    if(existing.length) throw new Error(t("mlp.error.teamsLocked"));
  }
  return session;
}

/** Don't silently leave a drawn playoff pointing at winners who no longer won. */
export async function guardMlpResultChange(db: Transaction, match: typeof matches.$inferSelect) {
  if(!match.mlpTieId) return;
  const [tie]=await db.select().from(mlpTies).where(eq(mlpTies.id,match.mlpTieId));
  if(!tie) throw new Error((await getT())("err.matchGone"));
  const later=await db.select({id:mlpTies.id}).from(mlpTies).where(and(
    eq(mlpTies.sessionId,tie.sessionId),
    tie.stage==="robin" ? ne(mlpTies.stage,"robin") : eq(mlpTies.stage,"final"),
  ));
  if(tie.stage!=="final" && later.length) throw new Error((await getT())("mlp.error.downstream"));
  await db.update(mlpTies).set({tiebreakWinner:null}).where(eq(mlpTies.id,tie.id));
}

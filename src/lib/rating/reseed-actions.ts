"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth/permissions";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { players, ratingSeeds } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import { RATING, RESEED_COOLDOWN_DAYS } from "./constants";
import { recomputeAll } from "./service";

/**
 * Self-service re-seed — SPEC.md §5.8.
 *
 * Players also play outside this group and their real DUPR keeps moving, so
 * without this our number drifts away from reality for the most active people.
 *
 * The cooldown counts only *self-service* seeds (createdBy === the player), so
 * an admin correction doesn't reset a player's clock, and a player can't dodge
 * the limit by asking an admin to adjust them first.
 */
export async function reseedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireLogin();
  const t = await getT();
  const db = getDb();

  const rating = Number(String(formData.get("rating") ?? ""));
  const reliability = Number(String(formData.get("reliability") ?? "0"));

  if (!Number.isFinite(rating) || rating < RATING.MIN || rating > RATING.MAX) {
    return {
      error: t("err.ratingRange", { min: RATING.MIN, max: RATING.MAX }),
      field: "rating",
    };
  }
  if (!Number.isFinite(reliability) || reliability < 0 || reliability > 100) {
    return { error: t("err.reliabilityRange"), field: "reliability" };
  }

  const last = await db
    .select({ effectiveAt: ratingSeeds.effectiveAt })
    .from(ratingSeeds)
    .where(and(eq(ratingSeeds.playerId, me.id), eq(ratingSeeds.createdBy, me.id)))
    .orderBy(desc(ratingSeeds.effectiveAt))
    .limit(1);

  const previous = last[0]?.effectiveAt;
  if (previous) {
    const days = (Date.now() - previous.getTime()) / 86_400_000;
    if (days < RESEED_COOLDOWN_DAYS) {
      const wait = Math.ceil(RESEED_COOLDOWN_DAYS - days);
      return {
        error: t.plural("reseed.locked", wait, { days: wait }),
        field: "rating",
      };
    }
  }

  await db.insert(ratingSeeds).values({
    playerId: me.id,
    rating,
    declaredReliability: reliability,
    source: "dupr",
    createdBy: me.id,
  });

  await recomputeAll();

  const row = await db
    .select({ username: players.username })
    .from(players)
    .where(eq(players.id, me.id))
    .limit(1);

  revalidatePath(`/p/${row[0]?.username ?? ""}`);
  revalidatePath("/leaderboard");
  revalidatePath("/");
  return {};
}

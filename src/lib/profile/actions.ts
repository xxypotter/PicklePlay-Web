"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth/permissions";
import type { FormState } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { players } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";

/** Roughly a 160px JPEG; anything larger means the client resize didn't run. */
const MAX_AVATAR_BYTES = 80_000;

export async function setAvatarAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireLogin();
  const t = await getT();
  const value = String(formData.get("avatar") ?? "").trim();

  if (value === "") {
    await getDb().update(players).set({ avatar: null }).where(eq(players.id, me.id));
  } else if (/^preset:\d{1,2}$/.test(value)) {
    await getDb().update(players).set({ avatar: value }).where(eq(players.id, me.id));
  } else if (value.startsWith("data:image/")) {
    if (value.length > MAX_AVATAR_BYTES) {
      return { error: t("err.imageTooLarge") };
    }
    await getDb().update(players).set({ avatar: value }).where(eq(players.id, me.id));
  } else {
    return { error: t("err.notAnImage") };
  }

  revalidatePath("/me");
  revalidatePath("/leaderboard");
  return {};
}

export async function setGenderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireLogin();
  const t = await getT();
  const value = String(formData.get("gender") ?? "");

  if (value !== "male" && value !== "female" && value !== "unspecified") {
    return { error: t("err.pickOption") };
  }

  await getDb().update(players).set({ gender: value }).where(eq(players.id, me.id));
  revalidatePath("/me");
  revalidatePath("/leaderboard");
  return {};
}

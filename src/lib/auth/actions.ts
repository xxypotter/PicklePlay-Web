"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { players, ratingSeeds } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import { getInviteCode, normalizeCode } from "@/lib/invite";
import { RATING, SKILL_PICKER } from "@/lib/rating/constants";
import { recomputeAll } from "@/lib/rating/service";
import { hashPin, validatePin, verifyPin } from "./pin";
import { checkLoginRate, recordLoginAttempt } from "./rate-limit";
import { createSession, destroySession } from "./session";
import type { FormState } from "./types";
import { NAME_TAKEN_KEY, normalizeUsername, validateUsername } from "./username";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/**
 * Where to land after signing in.
 *
 * Someone arriving from a shared session link wants that session, not the home
 * page. Only same-site absolute paths are honoured — anything else, including
 * a protocol-relative "//example.com" that a browser would treat as external,
 * falls back to home. A redirect target taken from a URL is an open-redirect
 * hole if it isn't checked.
 */
function safeNext(value: string): string {
  return /^\/(?!\/)[\w\-./?=&%]*$/.test(value) ? value : "/";
}

/**
 * Postgres unique-violation. The race we care about is two people claiming the
 * same name at once, where the database index is the only real arbiter.
 *
 * Drizzle wraps the driver error, so the pg code lives on `.cause` rather than
 * the top level — walk the chain instead of trusting either position.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code: unknown }).code === "23505"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getT();
  const db = getDb();

  // First account through the door runs the show and needs no code — that's
  // the bootstrap. Everyone after it must present the group invite code.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(players);

  if (count > 0) {
    const expected = await getInviteCode();
    if (!expected) {
      return { error: t("err.registrationClosed"), field: "inviteCode" };
    }
    if (normalizeCode(str(formData, "inviteCode")) !== normalizeCode(expected)) {
      return { error: t("err.badInviteCode"), field: "inviteCode" };
    }
  }

  const nameResult = validateUsername(str(formData, "username"));
  if (!nameResult.ok) return { error: t(nameResult.error), field: "username" };

  // Play is always mixed; this only decides which ranking table they land in.
  const gender = str(formData, "gender");
  if (gender !== "male" && gender !== "female" && gender !== "unspecified") {
    return { error: t("err.pickGender"), field: "gender" };
  }

  const pin = str(formData, "pin");
  const pinResult = validatePin(pin);
  if (!pinResult.ok) return { error: t(pinResult.error), field: "pin" };
  if (pin !== str(formData, "pinConfirm")) {
    return { error: t("err.pinMismatch"), field: "pinConfirm" };
  }

  // Starting rating: a real DUPR if they have one, otherwise the skill picker.
  let rating: number;
  let declaredReliability = 0;
  let source: "dupr" | "picker";

  if (str(formData, "ratingSource") === "dupr") {
    source = "dupr";
    rating = Number(str(formData, "dupr"));
    declaredReliability = Number(str(formData, "reliability") || "0");

    if (!Number.isFinite(rating) || rating < RATING.MIN || rating > RATING.MAX) {
      return {
        error: t("err.duprRange", { min: RATING.MIN, max: RATING.MAX }),
        field: "dupr",
      };
    }
    if (!Number.isFinite(declaredReliability) || declaredReliability < 0 || declaredReliability > 100) {
      return { error: t("err.reliabilityRange"), field: "reliability" };
    }
  } else {
    source = "picker";
    const choice = SKILL_PICKER.find((s) => s.key === str(formData, "skill"));
    if (!choice) return { error: t("err.pickSkill"), field: "skill" };
    rating = choice.rating;
  }

  let playerId: string;

  try {
    const inserted = await db
      .insert(players)
      .values({
        username: nameResult.username,
        usernameLower: nameResult.normalized,
        pinHash: await hashPin(pin),
        gender,
        // The first account ever created owns the group and is the only one who
        // can grant admin. Everyone after it starts as a plain player.
        role: count === 0 ? "superadmin" : "player",
      })
      .returning({ id: players.id });

    playerId = inserted[0].id;

    await db.insert(ratingSeeds).values({
      playerId,
      rating,
      declaredReliability,
      source,
      createdBy: playerId,
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: t(NAME_TAKEN_KEY), field: "username" };
    throw e;
  }

  await recomputeAll();
  await createSession(playerId);

  redirect(safeNext(str(formData, "next")));
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const normalized = normalizeUsername(str(formData, "username"));
  const pin = str(formData, "pin");

  if (!normalized || !pin) {
    return { error: t("err.enterNamePin"), field: "username" };
  }

  const limit = await checkLoginRate(normalized);
  if (!limit.allowed) {
    const minutes = limit.retryAfterMinutes ?? 1;
    return {
      error: t.plural("err.tooManyAttempts", minutes, { minutes }),
      field: "pin",
    };
  }

  const rows = await getDb()
    .select({ id: players.id, pinHash: players.pinHash, active: players.active })
    .from(players)
    .where(eq(players.usernameLower, normalized))
    .limit(1);

  const player = rows[0];

  // Hash even when the user doesn't exist, so response time doesn't reveal
  // which names are registered.
  const ok = player
    ? await verifyPin(pin, player.pinHash)
    : await verifyPin(pin, await hashPin("000000")).then(() => false);

  await recordLoginAttempt(normalized, ok && !!player?.active);

  if (!player || !ok) return { error: t("err.badLogin"), field: "pin" };
  if (!player.active) return { error: t("err.inactive"), field: "username" };

  await createSession(player.id);
  redirect(safeNext(str(formData, "next")));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

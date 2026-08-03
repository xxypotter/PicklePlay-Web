"use server";

import { revalidatePath } from "next/cache";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { generateInviteCode, setInviteCode } from "@/lib/invite";

/** Authorization lives here, not in the page — a server action is a public endpoint. */
async function requireAdmin() {
  const me = await getCurrentPlayer();
  if (!me || me.role !== "admin") throw new Error("Not authorized.");
  return me;
}

export async function rotateInviteCodeAction(): Promise<void> {
  const me = await requireAdmin();

  const code = await setInviteCode(generateInviteCode(), me.id);

  await getDb().insert(auditLog).values({
    actorId: me.id,
    action: "invite_code.rotate",
    targetType: "settings",
    detail: `new code ${code}`,
  });

  revalidatePath("/admin");
}

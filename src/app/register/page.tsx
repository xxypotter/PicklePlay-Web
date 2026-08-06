import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import RegisterForm from "./RegisterForm";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("auth.register");

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const { code, next } = await searchParams;
  if (await getCurrentPlayer()) redirect(next?.startsWith("/") ? next : "/");

  const t = await getT();
  const [{ count }] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(players);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10">
      <h1 className="text-2xl font-bold">{t("auth.registerTitle")}</h1>
      <p className="mt-2 mb-8 text-[var(--muted)]">{t("auth.registerLead")}</p>
      <RegisterForm
        needsCode={count > 0}
        codePrefill={code ?? ""}
        next={next ?? ""}
      />
    </main>
  );
}

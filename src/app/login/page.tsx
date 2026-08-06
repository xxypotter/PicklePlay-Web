import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import LoginForm from "./LoginForm";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("auth.login");

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (await getCurrentPlayer()) redirect(next?.startsWith("/") ? next : "/");

  const t = await getT();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10">
      <h1 className="text-2xl font-bold">{t("auth.loginTitle")}</h1>
      <p className="mt-2 mb-8 text-[var(--muted)]">{t("auth.loginLead")}</p>
      <LoginForm next={next ?? ""} />
    </main>
  );
}

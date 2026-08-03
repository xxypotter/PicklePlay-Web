import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players } from "@/lib/db/schema";
import RegisterForm from "./RegisterForm";

export const metadata = { title: "Create account · PicklePlay" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  if (await getCurrentPlayer()) redirect("/");

  const { code } = await searchParams;
  const [{ count }] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(players);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <p className="mt-2 mb-8 text-[var(--muted)]">
        No email, no password, no DUPR login. Just a name and a PIN.
      </p>
      <RegisterForm needsCode={count > 0} codePrefill={code ?? ""} />
    </main>
  );
}

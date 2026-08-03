import { desc } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players } from "@/lib/db/schema";
import { getInviteCode } from "@/lib/invite";
import InviteCard from "./InviteCard";

export const metadata = { title: "Admin · PicklePlay" };

export default async function AdminPage() {
  const me = await getCurrentPlayer();
  // 404 rather than 403: don't confirm the page exists to someone who can't use it.
  if (!me || me.role !== "admin") notFound();

  const db = getDb();
  const [code, roster, headerList] = await Promise.all([
    getInviteCode(),
    db
      .select({ username: players.username, role: players.role, createdAt: players.createdAt })
      .from(players)
      .orderBy(desc(players.createdAt))
      .limit(50),
    headers(),
  ]);

  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Link href="/" className="text-sm font-medium text-[var(--accent)] underline">
          Back
        </Link>
      </div>

      <InviteCard code={code} origin={`${proto}://${host}`} />

      <section className="card mt-5">
        <h2 className="text-sm font-medium text-[var(--muted)]">
          Players ({roster.length})
        </h2>
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {roster.map((p) => (
            <li key={p.username} className="flex items-center justify-between py-2.5">
              <span className="font-medium">{p.username}</span>
              {p.role !== "player" ? (
                <span className="text-xs font-semibold uppercase text-[var(--accent)]">
                  {p.role}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

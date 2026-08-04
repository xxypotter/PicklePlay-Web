import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";
import SessionForm from "./SessionForm";

export const metadata = { title: "New session · PicklePlay" };

export default async function NewSessionPage() {
  const me = await getCurrentPlayer();
  if (!me || !canManageSessions(me.role)) notFound();

  const roster = await getDb()
    .select({
      id: players.id,
      username: players.username,
      rating: playerStats.rating,
    })
    .from(players)
    .leftJoin(playerStats, eq(playerStats.playerId, players.id))
    .where(eq(players.active, true))
    .orderBy(asc(players.username));

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">New session</h1>
        <Link href="/" className="text-sm font-medium text-[var(--accent)] underline">
          Cancel
        </Link>
      </div>
      <SessionForm roster={roster} />
    </main>
  );
}

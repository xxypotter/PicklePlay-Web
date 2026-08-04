import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
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
    <>
      <TopBar title="New session" back="/" />
      <main className="screen pt-4">
        <SessionForm roster={roster} />
      </main>
    </>
  );
}

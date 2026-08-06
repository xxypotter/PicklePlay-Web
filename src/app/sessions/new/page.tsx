import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import TopBar, { safeFrom } from "@/components/TopBar";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import SessionForm from "./SessionForm";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("form.newSession");

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const me = await getCurrentPlayer();
  if (!me || !canManageSessions(me.role)) notFound();

  const t = await getT(me.locale);
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
      {/* Reached from the centre button, which exists on every screen. */}
      <TopBar title={t("form.newSession")} back={safeFrom(from, "/")} />
      <main className="screen pt-4">
        <SessionForm roster={roster} />
      </main>
    </>
  );
}

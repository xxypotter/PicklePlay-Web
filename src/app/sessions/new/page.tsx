import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import TopBar, { safeFrom } from "@/components/TopBar";
import { canCreatePrivateSession, canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import { sortByUsername } from "@/lib/players/sort";
import { loadCopySource } from "@/lib/sessions/copy-source";
import SessionForm from "./SessionForm";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("form.newSession");

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; copy?: string; players?: string }>;
}) {
  const { from, copy, players: withPlayers } = await searchParams;
  const me = await getCurrentPlayer();
  if (!me || !canManageSessions(me.role)) notFound();

  const t = await getT(me.locale);
  const [roster, copySource] = await Promise.all([
    getDb()
      .select({
        id: players.id,
        username: players.username,
        rating: playerStats.rating,
      })
      .from(players)
      .leftJoin(playerStats, eq(playerStats.playerId, players.id))
      .where(eq(players.active, true))
      .then(sortByUsername),
    // `?players=1` is Copy with players; plain `?copy=` is the setup only.
    loadCopySource(me, copy, withPlayers === "1"),
  ]);

  return (
    <>
      {/* Reached from the centre button, or from Copy on a finished session. */}
      <TopBar
        title={copySource ? t("form.copySession") : t("form.newSession")}
        back={safeFrom(from, "/")}
      />
      <main className="screen pt-4">
        <SessionForm
          roster={roster}
          canMakePrivate={canCreatePrivateSession(me)}
          copy={copySource}
        />
      </main>
    </>
  );
}

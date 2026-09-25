import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import TopBar, { safeFrom } from "@/components/TopBar";
import { canCreatePrivateSession, canManageSessions, canSeeSession } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats, sessions, signups } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import { sortByUsername } from "@/lib/players/sort";
import { copySourceFrom, type CopySource } from "@/lib/sessions/copy";
import SessionForm from "./SessionForm";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("form.newSession");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The session to start from, if `?copy=` names one this person may see.
 *
 * Anything else — a malformed id, a session that is gone, a private one they
 * are not part of — quietly gives the blank form. Saying "you can't copy that"
 * would confirm a private session exists to someone it is hidden from.
 */
async function loadCopy(
  id: string | undefined,
  me: NonNullable<Awaited<ReturnType<typeof getCurrentPlayer>>>,
): Promise<CopySource | null> {
  // Checked before it reaches Postgres, which would reject a non-uuid outright.
  if (!id || !UUID.test(id)) return null;

  const db = getDb();
  const found = await db
    .select({
      title: sessions.title,
      location: sessions.location,
      startsAt: sessions.startsAt,
      courtNames: sessions.courtNames,
      maxPlayers: sessions.maxPlayers,
      format: sessions.format,
      notes: sessions.notes,
      rated: sessions.rated,
      isPrivate: sessions.isPrivate,
      createdBy: sessions.createdBy,
    })
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);

  const source = found[0];
  if (!source) return null;

  // The same rule the session page applies: private means you had to be in it.
  const playing = await db
    .select({ id: signups.id })
    .from(signups)
    .where(and(eq(signups.sessionId, id), eq(signups.playerId, me.id), eq(signups.state, "in")))
    .limit(1);

  if (!canSeeSession(me, source, playing.length > 0)) return null;

  return copySourceFrom(source, canCreatePrivateSession(me));
}

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; copy?: string }>;
}) {
  const { from, copy } = await searchParams;
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
    loadCopy(copy, me),
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

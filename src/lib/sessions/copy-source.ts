import { and, asc, eq } from "drizzle-orm";
import { canCreatePrivateSession, canSeeSession, type Actor } from "@/lib/auth/policy";
import { getDb } from "@/lib/db";
import { mlpTeams, players, sessions, signups } from "@/lib/db/schema";
import { teamLineups } from "@/lib/mlp/rules";
import { copyRoster, copySourceFrom, type CopiedTeam, type CopySource } from "./copy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The session to copy from, if `id` names one this person may see.
 *
 * Anything else — a malformed id, a session that is gone, a private one they
 * are not part of — quietly gives nothing. Saying "you can't copy that" would
 * confirm a private session exists to someone it is hidden from.
 *
 * Used twice: by the create page to fill the form, and by Create itself to
 * re-read teams and pairs from the source rather than trust them from the
 * browser. Both go through the same visibility rule.
 */
export async function loadCopySource(
  me: Actor,
  id: string | undefined | null,
  withPlayers: boolean,
): Promise<CopySource | null> {
  // Checked before it reaches Postgres, which would reject a non-uuid outright.
  if (!id || !UUID.test(id)) return null;

  const db = getDb();
  const [source] = await db
    .select({
      title: sessions.title,
      location: sessions.location,
      startsAt: sessions.startsAt,
      courtNames: sessions.courtNames,
      maxPlayers: sessions.maxPlayers,
      format: sessions.format,
      mlpRandomMixed: sessions.mlpRandomMixed,
      notes: sessions.notes,
      rated: sessions.rated,
      isPrivate: sessions.isPrivate,
      createdBy: sessions.createdBy,
    })
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  if (!source) return null;

  // The same rule the session page applies: private means you had to be in it.
  const playing = await db
    .select({ id: signups.id })
    .from(signups)
    .where(and(eq(signups.sessionId, id), eq(signups.playerId, me.id), eq(signups.state, "in")))
    .limit(1);
  if (!canSeeSession(me, source, playing.length > 0)) return null;

  const copy = copySourceFrom(source, canCreatePrivateSession(me));
  if (!withPlayers) return copy;

  // Only people who can still be picked: a deactivated account isn't offered.
  const roster = await db
    .select({
      playerId: signups.playerId,
      state: signups.state,
      waitlistPos: signups.waitlistPos,
      createdAt: signups.createdAt,
      partnerId: signups.partnerId,
    })
    .from(signups)
    .innerJoin(players, eq(players.id, signups.playerId))
    .where(and(eq(signups.sessionId, id), eq(players.active, true)));

  copy.copyFrom = id;
  copy.players = copyRoster(roster);

  if (source.format === "mlp") {
    const teams = await db
      .select()
      .from(mlpTeams)
      .where(eq(mlpTeams.sessionId, id))
      .orderBy(asc(mlpTeams.slot));
    // Spelled out, so a draw from before explicit lineups copies as it played.
    copy.teams = teams.map((team): CopiedTeam => {
      const lineup = teamLineups(team);
      return {
        name: team.name,
        m1: team.m1, m2: team.m2, w1: team.w1, w2: team.w2,
        women1: lineup.women[0], women2: lineup.women[1],
        men1: lineup.men[0], men2: lineup.men[1],
      };
    });
  }

  if (source.format === "fixed") {
    // Both rows of a pair point at each other; keep each pair once, in roster order.
    const order = new Map(copy.players.map((pid, i) => [pid, i]));
    const seen = new Set<string>();
    copy.pairs = [];
    for (const r of [...roster].sort((a, b) => (order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0))) {
      if (!r.partnerId || seen.has(r.playerId) || seen.has(r.partnerId)) continue;
      seen.add(r.playerId); seen.add(r.partnerId);
      copy.pairs.push([r.playerId, r.partnerId]);
    }
  }

  return copy;
}

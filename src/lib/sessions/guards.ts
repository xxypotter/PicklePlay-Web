/**
 * Session-scoped authorization.
 *
 * The role checks in auth/permissions.ts answer "is this person an admin?".
 * That was enough while there were two admins; it stops being enough once
 * several people run sessions, because being an admin says nothing about
 * *whose* night you are allowed to touch. These helpers answer the question
 * that actually matters — may this person change *this* session — and they
 * throw, so an unauthorized caller fails before anything is written.
 *
 * Not a "use server" module: it exports helpers rather than actions, and the
 * actions import it.
 */
import { eq } from "drizzle-orm";
import { requireLogin } from "@/lib/auth/permissions";
import {
  type Actor,
  canOrganizeSession,
  canScoreMatch,
  PermissionError,
  type SessionScope,
} from "@/lib/auth/policy";
import { getDb } from "@/lib/db";
import { matches, sessions } from "@/lib/db/schema";

/** The ownership and status of a session, or null if it's gone. */
export async function loadSessionScope(sessionId: string): Promise<SessionScope | null> {
  const found = await getDb()
    .select({ createdBy: sessions.createdBy, status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  return found[0] ?? null;
}

/**
 * Gate a management action on organizing this session.
 *
 * Used by everything that changes a session's shape: details, roster,
 * attendance, rounds, starting, ending, deleting.
 */
export async function requireOrganizer(
  sessionId: string,
): Promise<{ me: Actor; session: SessionScope }> {
  const me = await requireLogin();
  const session = await loadSessionScope(sessionId);

  if (!session) throw new Error("That session no longer exists.");
  if (!canOrganizeSession(me, session)) {
    throw new PermissionError("Only the organizer of this session can change it.");
  }

  return { me, session };
}

/**
 * Gate scoring on the match rather than the session, since who played in it is
 * part of the answer while the night is still running.
 */
export async function requireScorer(
  matchId: string,
  /**
   * Voiding a match is a correction to the record rather than ordinary score
   * entry, so having played in it doesn't grant it — pass false and only an
   * admin during the night, or the organizer afterwards, gets through.
   */
  { allowParticipant = true }: { allowParticipant?: boolean } = {},
): Promise<{
  me: Actor;
  sessionId: string | null;
}> {
  const me = await requireLogin();
  const db = getDb();

  const found = await db
    .select({
      sessionId: matches.sessionId,
      a1: matches.a1,
      a2: matches.a2,
      b1: matches.b1,
      b2: matches.b2,
    })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  const match = found[0];
  if (!match) throw new Error("That match no longer exists.");

  // A match with no session can't be closed, so treat it as open play.
  const scope: SessionScope = match.sessionId
    ? ((await loadSessionScope(match.sessionId)) ?? { createdBy: null, status: "open" })
    : { createdBy: null, status: "open" };

  const playedInIt =
    allowParticipant && [match.a1, match.a2, match.b1, match.b2].includes(me.id);

  if (!canScoreMatch(me, scope, playedInIt)) {
    throw new PermissionError(
      scope.status === "closed"
        ? "This session is finished — only its organizer can change a score now."
        : "Only players in this match can record it.",
    );
  }

  return { me, sessionId: match.sessionId };
}

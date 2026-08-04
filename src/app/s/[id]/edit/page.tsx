import { and, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import TopBar, { safeFrom } from "@/components/TopBar";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { sessions, signups } from "@/lib/db/schema";
import EditForm from "./EditForm";

export const metadata = { title: "Edit session · PicklePlay" };

export default async function EditSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;

  const me = await getCurrentPlayer();
  if (!me || !canManageSessions(me.role)) notFound();

  const db = getDb();
  const found = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const session = found[0];
  if (!session) notFound();

  const [{ confirmed }] = await db
    .select({ confirmed: sql<number>`count(*)::int` })
    .from(signups)
    .where(and(eq(signups.sessionId, id), eq(signups.state, "in")));

  return (
    <>
      {/* Edit opens from both the session page and the play console. */}
      <TopBar title="Edit session" back={safeFrom(from, `/s/${id}`)} />
      <main className="screen pt-4">
        {session.status !== "open" ? (
          <div className="card text-center">
            <p className="font-medium">This session has started.</p>
            <p className="hint">
              Details lock once play begins, so the schedule always matches the session
              it was built from. Reopen it from the play console if nothing has been
              played yet.
            </p>
          </div>
        ) : (
          <EditForm
            session={{
              id: session.id,
              title: session.title,
              location: session.location,
              startsAtIso: session.startsAt.toISOString(),
              courtNames: session.courtNames,
              maxPlayers: session.maxPlayers,
              format: session.format,
              rated: session.rated,
              notes: session.notes,
              confirmed,
            }}
          />
        )}
      </main>
    </>
  );
}

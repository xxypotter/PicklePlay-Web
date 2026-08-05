/**
 * Sign in as a player without a PIN — development only.
 *
 * Exists so the UI can be driven end to end in testing: score entry as the
 * player who was on court, an admin correcting it afterwards, self-join versus
 * being added by the organizer. None of those can be exercised from outside a
 * logged-in session, and every one of them has had a real bug in it.
 *
 * The gate is `NODE_ENV`, not a config flag or an env var someone could set by
 * mistake. `next build` compiles with NODE_ENV=production, so on Vercel this
 * route is a 404 with no code path to anything else. A flag would be a switch
 * that could be flipped; this cannot be turned on in a deployed build.
 *
 * It also refuses to run against a database that isn't the dev one, so pointing
 * a local server at production by accident doesn't hand out sessions.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const DEV_DATABASE = "pickleplay_dev";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const db = getDb();

  const probe = await db.execute<{ name: string }>(sql`select current_database() as name`);
  const name = probe.rows[0]?.name;
  if (name !== DEV_DATABASE) {
    return NextResponse.json(
      { error: `Refusing: connected to "${name}", not ${DEV_DATABASE}.` },
      { status: 403 },
    );
  }

  const username = new URL(request.url).searchParams.get("as");
  if (!username) {
    return NextResponse.json({ error: "Pass ?as=<username>." }, { status: 400 });
  }

  const found = await db
    .select({ id: players.id, username: players.username, role: players.role })
    .from(players)
    .where(eq(players.usernameLower, username.toLowerCase()))
    .limit(1);

  const player = found[0];
  if (!player) {
    return NextResponse.json({ error: `No player named ${username}.` }, { status: 404 });
  }

  await createSession(player.id);
  return NextResponse.json({ ok: true, signedInAs: player.username, role: player.role });
}

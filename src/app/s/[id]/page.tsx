import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import Tabs from "@/components/Tabs";
import TopBar, { safeFrom } from "@/components/TopBar";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats, sessions, signups } from "@/lib/db/schema";
import { getInviteCode } from "@/lib/invite";
import { closeStaleSessions } from "@/lib/sessions/auto-close";
import { getAllRounds, getSessionStandings } from "@/lib/sessions/queries";
import RsvpButtons, { type MyState } from "./RsvpButtons";
import Schedule from "./Schedule";
import ShareLink from "./ShareLink";
import Standings from "./Standings";
import { DeleteSessionButton, EndSessionButton } from "./play/PlayControls";

export const metadata = { title: "Session · PicklePlay" };

const FORMAT_LABEL: Record<string, string> = {
  regular: "Regular round robin — partner with everyone once",
  balanced: "Balanced round robin — even team ratings",
  fixed: "Fixed partners",
  custom: "Custom",
  social: "Social",
  manual: "Manual",
  king: "King of the court",
};

type TabKey = "info" | "standings" | "schedule";

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; from?: string }>;
}) {
  const { id } = await params;
  const { tab, from } = await searchParams;
  const active: TabKey =
    tab === "standings" ? "standings" : tab === "schedule" ? "schedule" : "info";

  const db = getDb();

  // Sweep before reading, so a night nobody ended shows as finished.
  await closeStaleSessions();

  const found = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const session = found[0];
  if (!session) notFound();

  const [me, roster, allRounds, standings, headerList, inviteCode] = await Promise.all([
    getCurrentPlayer(),
    db
      .select({
        playerId: signups.playerId,
        username: players.username,
        state: signups.state,
        waitlistPos: signups.waitlistPos,
        addedByOrganizer: signups.addedByOrganizer,
        rating: playerStats.rating,
        provisional: playerStats.provisional,
      })
      .from(signups)
      .innerJoin(players, eq(players.id, signups.playerId))
      .leftJoin(playerStats, eq(playerStats.playerId, signups.playerId))
      .where(eq(signups.sessionId, id))
      .orderBy(asc(signups.createdAt)),
    getAllRounds(id, session.courtNames),
    getSessionStandings(id),
    headers(),
    getInviteCode(),
  ]);

  const confirmed = roster.filter((r) => r.state === "in");
  const waiting = roster.filter((r) => r.state === "waitlist");
  const mine = me ? roster.find((r) => r.playerId === me.id) : undefined;
  const myState: MyState = (mine?.state as MyState) ?? "out";

  const host = headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const isAdmin = !!me && canManageSessions(me.role);
  const canDelete =
    !!me && (me.role === "superadmin" || (isAdmin && session.createdBy === me.id));
  const spotsLeft = Math.max(0, session.maxPlayers - confirmed.length);

  const unscored = allRounds.flatMap((r) => r.matches).filter((m) => !m.completed).length;
  const base = `/s/${id}`;
  // A session is reached from Home, My sessions, the play console, or a shared
  // link. Only the caller knows which, so back follows `from` and falls back
  // to Home for a link opened cold.
  const backTo = safeFrom(from, "/");

  /** Tab links must carry `from`, or switching tabs would strip it. */
  const here = (key: TabKey) => {
    const q = new URLSearchParams();
    if (key !== "info") q.set("tab", key);
    if (backTo !== "/") q.set("from", backTo);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  // Tapping a name and coming back should land on the tab you left.
  const backHere = here(active);

  return (
    <>
      <TopBar title={session.title} back={backTo} />
      <Tabs
        active={active}
        items={[
          { key: "info", label: "Session", href: here("info") },
          { key: "standings", label: "Standings", href: here("standings") },
          { key: "schedule", label: "Matchups", href: here("schedule") },
        ]}
      />

      <main className="screen pt-4">
        {/*
          Each tab answers one question. Pinning "your next match" on all three
          assumed rounds get played in order, which they don't — so scores now
          live only on Matchups, where you find the match you actually played.
        */}
        {active === "standings" ? (
          <Standings rows={standings} meId={me?.id} backHere={backHere} />
        ) : active === "schedule" ? (
          <Schedule
            rounds={allRounds}
            meId={me?.id}
            courtCount={session.courtNames.length}
            canScoreAny={isAdmin}
          />
        ) : (
          <>
            <section className="card relative overflow-hidden">
              {session.status === "closed" ? <span className="ribbon">Finished</span> : null}

              <dl className="flex flex-col gap-2 text-sm">
                <InfoRow icon="🕐" label="When">
                  <LocalDateTime iso={session.startsAt.toISOString()} />
                </InfoRow>
                {session.location ? (
                  <InfoRow icon="📍" label="Where">
                    {session.location}
                  </InfoRow>
                ) : null}
                <InfoRow icon="🏟" label="Courts">
                  {session.courtNames.join(", ")}
                </InfoRow>
                <InfoRow icon="🎾" label="Format">
                  {FORMAT_LABEL[session.format] ?? session.format}
                </InfoRow>
                <InfoRow icon="👥" label="Signed up">
                  <span className="font-semibold text-[var(--accent)]">
                    {confirmed.length}/{session.maxPlayers}
                  </span>
                  {waiting.length > 0 ? ` · ${waiting.length} waiting` : ""}
                </InfoRow>
                <InfoRow icon="⭐" label="Rated">
                  {session.rated ? "Counts toward ratings" : "Casual — no rating change"}
                </InfoRow>
              </dl>

              {session.notes ? (
                <p className="mt-3 whitespace-pre-line border-t border-[var(--border)] pt-3 text-sm text-[var(--muted)]">
                  {session.notes}
                </p>
              ) : null}
            </section>

            <div className="mt-3">
              {me ? (
                session.status === "closed" ? (
                  <p className="card text-center text-sm text-[var(--muted)]">
                    This session is finished.
                  </p>
                ) : (
                  <RsvpButtons
                    sessionId={id}
                    state={myState}
                    full={spotsLeft === 0}
                    addedByOrganizer={mine?.addedByOrganizer ?? false}
                  />
                )
              ) : (
                /*
                 * Someone opening a shared link may not have an account yet.
                 * Offering only "log in" strands them at a registration form
                 * demanding a code they were never given, so the sign-up link
                 * carries the current code and both routes come back here
                 * afterwards rather than dumping them on the home page.
                 */
                <div className="flex flex-col gap-2">
                  <Link
                    href={`/register?next=${encodeURIComponent(`/s/${id}`)}${
                      inviteCode ? `&code=${inviteCode}` : ""
                    }`}
                    className="btn-primary block text-center"
                  >
                    Create an account to join
                  </Link>
                  <Link
                    href={`/login?next=${encodeURIComponent(`/s/${id}`)}`}
                    className="btn-ghost block text-center"
                  >
                    I already have an account
                  </Link>
                </div>
              )}
            </div>

            <div className="mt-3">
              <ShareLink url={`${proto}://${host}/s/${id}`} title={session.title} />
            </div>

            <Roster
              title={`Playing (${confirmed.length})`}
              rows={confirmed}
              empty="Nobody yet — be first."
              backHere={backHere}
            />
            {waiting.length > 0 ? (
              <Roster
                title={`Waitlist (${waiting.length})`}
                rows={waiting}
                empty=""
                backHere={backHere}
                showPosition
              />
            ) : null}

            {/*
              The primary action follows the lifecycle: set up, then end. Once
              a session is under way "Run the session" reads like it hasn't
              started, so the play console moves to a secondary link and the
              headline action becomes the one that's actually left to do.
            */}
            {isAdmin ? (
              <div className="mt-4 flex flex-col gap-2">
                {session.status === "open" ? (
                  <>
                    <Link href={`${base}/play?from=${encodeURIComponent(backHere)}`} className="btn-accent block text-center">
                      Set up &amp; start
                    </Link>
                    <Link href={`${base}/edit?from=${encodeURIComponent(backHere)}`} className="btn-ghost block text-center">
                      Edit details
                    </Link>
                  </>
                ) : session.status === "live" ? (
                  <>
                    <EndSessionButton
                      sessionId={id}
                      unscored={unscored}
                      className="w-full"
                    />
                    <Link href={`${base}/play?from=${encodeURIComponent(backHere)}`} className="btn-ghost block text-center">
                      Manage matches &amp; players
                    </Link>
                  </>
                ) : (
                  <Link href={`${base}/play?from=${encodeURIComponent(backHere)}`} className="btn-ghost block text-center">
                    Manage session
                  </Link>
                )}
              </div>
            ) : null}

            {canDelete ? <DeleteSessionButton sessionId={id} /> : null}
          </>
        )}
      </main>
    </>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-5 shrink-0 text-center text-xs leading-6 opacity-60">{icon}</span>
      <dt className="w-20 shrink-0 leading-6 text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 flex-1 leading-6">{children}</dd>
    </div>
  );
}

interface Row {
  playerId: string;
  username: string;
  waitlistPos: number | null;
  rating: number | null;
  provisional: boolean | null;
}

function Roster({
  title,
  rows,
  empty,
  backHere,
  showPosition = false,
}: {
  title: string;
  rows: Row[];
  empty: string;
  backHere: string;
  showPosition?: boolean;
}) {
  return (
    <section className="card-tight mt-3 overflow-hidden">
      <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li
              key={r.playerId}
              className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0"
            >
              {showPosition ? (
                <span className="w-5 shrink-0 text-sm text-[var(--muted)] tabular-nums">
                  {r.waitlistPos}
                </span>
              ) : null}
              <Link
                href={`/p/${r.username}?from=${encodeURIComponent(backHere)}`}
                className="min-w-0 flex-1 truncate font-medium"
              >
                {r.username}
              </Link>
              <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--muted)]">
                {r.rating === null ? "—" : r.rating.toFixed(3)}
                {r.provisional ? "?" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The picture a chat app shows when someone pastes a session link.
 *
 * A card with no image is a grey box with two lines of text, which reads as a
 * spam link in a group chat. This draws the session itself — title, when,
 * where, and whether there's room — so the message carries its own answer.
 *
 * Rendered server-side into a PNG by Next's ImageResponse, which supports a
 * deliberately small slice of CSS: flex only, no grid, no external assets. Kept
 * to plain boxes and system-ish fonts for that reason.
 */
import { and, eq, sql } from "drizzle-orm";
import { ImageResponse } from "next/og";
import { getDb } from "@/lib/db";
import { matches, sessions, signups } from "@/lib/db/schema";
import { getLocale, getT } from "@/lib/i18n/server";
import { shareDescription } from "@/lib/sessions/share";

export const alt = "PicklePlay session";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#f97316";
const INK = "#0b0b0c";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const found = await db
    .select({
      title: sessions.title,
      startsAt: sessions.startsAt,
      location: sessions.location,
      courtNames: sessions.courtNames,
      maxPlayers: sessions.maxPlayers,
      status: sessions.status,
    })
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);

  const locale = await getLocale(null);
  const t = await getT(null);
  const session = found[0];

  const [[signedUp], [played]] = session
    ? await Promise.all([
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(signups)
          .where(and(eq(signups.sessionId, id), eq(signups.state, "in"))),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(matches)
          .where(and(eq(matches.sessionId, id), eq(matches.status, "completed"))),
      ])
    : [[{ n: 0 }], [{ n: 0 }]];

  const heading = session?.title ?? t("app.name");
  const detail = session
    ? shareDescription(
        { ...session, signedUp: signedUp?.n ?? 0, completedMatches: played?.n ?? 0 },
        t,
        locale,
      )
    : t("app.description");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ fontSize: 64 }}>🏓</div>
          <div style={{ fontSize: 36, fontWeight: 700, color: ACCENT }}>
            {t("app.name")}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 84,
              fontWeight: 800,
              color: INK,
              lineHeight: 1.05,
              // Two lines at most; a long title should truncate, not push the
              // details off the bottom of the card.
              display: "block",
              overflow: "hidden",
              maxHeight: 190,
            }}
          >
            {heading}
          </div>
          <div style={{ fontSize: 38, color: "#52525b", lineHeight: 1.3 }}>{detail}</div>
        </div>

        <div style={{ display: "flex", height: 12, borderRadius: 6, background: ACCENT }} />
      </div>
    ),
    size,
  );
}

import Link from "next/link";
import LocalDateTime from "@/components/LocalDateTime";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { getT } from "@/lib/i18n/server";

export interface SessionCardData {
  id: string;
  title: string;
  location: string | null;
  startsAt: Date;
  status: string;
  rated: boolean;
  courtNames: string[];
  maxPlayers: number;
  signedUp: number;
  format: string;
  myState?: string;
  organizer?: string | null;
}

/**
 * The event card from the home screen: title, then icon-led rows for when,
 * where and how, with a diagonal ribbon in the corner once it's over.
 */
export default async function SessionCard({
  session: s,
  /** Where back should return to — the list and tab this card was tapped from. */
  from,
  /** The viewer's language, so the card doesn't re-read the cookie per card. */
  locale,
}: {
  session: SessionCardData;
  from?: string;
  locale?: string | null;
}) {
  const t = await getT(locale);

  const ribbon =
    s.status === "closed"
      ? t("card.finished")
      : s.status === "live"
        ? t("card.playing")
        : null;

  const href = from ? `/s/${s.id}?from=${encodeURIComponent(from)}` : `/s/${s.id}`;

  return (
    <Link href={href} className="relative block overflow-hidden card active:opacity-70">
      {ribbon ? (
        <span
          className="ribbon"
          style={s.status === "live" ? { background: "var(--success)" } : undefined}
        >
          {ribbon}
        </span>
      ) : null}

      <h3 className="pr-16 text-lg font-bold">{s.title}</h3>

      <dl className="mt-2 flex flex-col gap-1.5 text-sm">
        <Row icon="🕐">
          <LocalDateTime iso={s.startsAt.toISOString()} />
        </Row>
        {s.location ? <Row icon="📍">{s.location}</Row> : null}
        <Row icon="🏟">
          {t("card.courtsFormat", {
            courts: t.plural("card.courts", s.courtNames.length, {
              names: s.courtNames.join(", "),
            }),
            format: t(`format.short.${s.format}` as DictKey),
          })}
        </Row>
        <Row icon="👥">
          {t.rich("card.signedUp", {
            count: (
              <span key="n" className="font-semibold text-[var(--accent)]">
                {s.signedUp}
              </span>
            ),
            max: s.maxPlayers,
          })}
          {/* Name alone read as another player rather than whose session it is. */}
          {s.organizer ? ` · ${t("card.organizer", { name: s.organizer })}` : ""}
          {!s.rated ? t("card.casual") : ""}
        </Row>
      </dl>

      {s.myState ? (
        <p className="mt-3 text-sm font-semibold text-[var(--accent)]">
          {s.myState === "in" ? t("card.youreIn") : t("card.onWaitlist")}
        </p>
      ) : null}
    </Link>
  );
}

function Row({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-5 shrink-0 text-center text-xs leading-5 opacity-60">{icon}</span>
      <dd className="min-w-0 text-[var(--foreground)]">{children}</dd>
    </div>
  );
}

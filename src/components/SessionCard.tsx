import Link from "next/link";
import LocalDateTime from "@/components/LocalDateTime";

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

const FORMAT_LABEL: Record<string, string> = {
  regular: "Regular round robin",
  balanced: "Balanced round robin",
  fixed: "Fixed partners",
  custom: "Custom",
  social: "Social",
  manual: "Manual",
  king: "King of the court",
};

/**
 * The event card from the home screen: title, then icon-led rows for when,
 * where and how, with a diagonal ribbon in the corner once it's over.
 */
export default function SessionCard({
  session: s,
  /** Where back should return to — the list and tab this card was tapped from. */
  from,
}: {
  session: SessionCardData;
  from?: string;
}) {
  const ribbon =
    s.status === "closed" ? "Finished" : s.status === "live" ? "Playing" : null;

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
          Court{s.courtNames.length === 1 ? "" : "s"} {s.courtNames.join(", ")} ·{" "}
          {FORMAT_LABEL[s.format] ?? s.format}
        </Row>
        <Row icon="👥">
          <span className="font-semibold text-[var(--accent)]">
            {s.signedUp}/{s.maxPlayers}
          </span>{" "}
          signed up
          {/* Name alone read as another player rather than whose session it is. */}
          {s.organizer ? ` · organizer ${s.organizer}` : ""}
          {!s.rated ? " · casual" : ""}
        </Row>
      </dl>

      {s.myState ? (
        <p className="mt-3 text-sm font-semibold text-[var(--accent)]">
          {s.myState === "in" ? "You're in" : "You're on the waitlist"}
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

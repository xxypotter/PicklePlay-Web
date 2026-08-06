import { getT } from "@/lib/i18n/server";

/**
 * Result margins, most recent last.
 *
 * The record screen deliberately says nothing about rating, so a rating line
 * would be the wrong shape here even if it looked nice. This answers a
 * different question, and one a rating curve hides: *how* you win. A row of
 * short green bars is a player scraping through; a mix of tall bars both ways
 * is someone playing above and below their level. Same win rate, different
 * player.
 *
 * Server-rendered SVG for the same reason as RatingChart — a few dozen bars
 * don't justify a charting dependency.
 */
export default async function MarginChart({
  margins,
  locale,
}: {
  /** Points for minus points against, per match, oldest first. */
  margins: number[];
  locale?: string | null;
}) {
  const t = await getT(locale);

  if (margins.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--muted)]">
        {t("record.marginEmpty")}
      </p>
    );
  }

  // Only the tail fits legibly on a phone; older results compress to noise.
  const shown = margins.slice(-40);
  const width = 320;
  const height = 90;
  const mid = height / 2;
  const peak = Math.max(4, ...shown.map((m) => Math.abs(m)));

  const slot = width / shown.length;
  const barWidth = Math.max(2, Math.min(10, slot * 0.62));

  const wins = shown.filter((m) => m > 0).length;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={t("record.marginAria", { count: shown.length, wins })}
    >
      {/* The line results are measured against, not a decoration. */}
      <line
        x1="0"
        y1={mid}
        x2={width}
        y2={mid}
        stroke="var(--border)"
        strokeWidth="1"
      />
      {shown.map((m, i) => {
        const h = (Math.abs(m) / peak) * (mid - 6);
        const x = i * slot + (slot - barWidth) / 2;
        const won = m > 0;
        return (
          <rect
            key={i}
            x={x.toFixed(1)}
            y={(won ? mid - h : mid).toFixed(1)}
            width={barWidth.toFixed(1)}
            height={Math.max(1.5, h).toFixed(1)}
            rx={Math.min(2, barWidth / 2)}
            fill={won ? "var(--success)" : "var(--danger)"}
            opacity={won ? 0.85 : 0.7}
          />
        );
      })}
      <title>
        Last {shown.length} matches: {wins} won, {shown.length - wins} lost. Bars
        show the winning or losing margin.
      </title>
    </svg>
  );
}

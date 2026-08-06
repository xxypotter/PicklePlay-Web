import { getT } from "@/lib/i18n/server";

/**
 * Rating history sparkline.
 *
 * Plain server-rendered SVG — no charting library, no client JavaScript. The
 * data is a couple of dozen points and the shape is a single polyline, so a
 * dependency would cost more than it's worth.
 */
export default async function RatingChart({
  points,
  locale,
}: {
  points: number[];
  locale?: string | null;
}) {
  const t = await getT(locale);

  if (points.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-[var(--muted)]">
        {t("rating.chartEmpty")}
      </p>
    );
  }

  const width = 320;
  const height = 90;
  const pad = 6;

  const min = Math.min(...points);
  const max = Math.max(...points);
  // A dead-flat run would divide by zero; give it a little headroom instead.
  const span = max - min < 0.05 ? 0.05 : max - min;

  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;
  const last = points[points.length - 1];
  const rising = last >= points[0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={t("rating.chartAria", {
        count: points.length,
        rating: last.toFixed(3),
      })}
      preserveAspectRatio="none"
    >
      <polygon points={area} fill="var(--accent)" opacity="0.08" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(points.length - 1)} cy={y(last)} r="3.5" fill="var(--accent)" />
      <title>
        {rising ? "Up" : "Down"} from {points[0].toFixed(3)} to {last.toFixed(3)}
      </title>
    </svg>
  );
}

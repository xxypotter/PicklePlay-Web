/**
 * Reliability as a filled ring, the way DUPR shows it.
 *
 * A bare "38%" invites the wrong reading — it looks like a score, and a low one
 * looks like a bad player. The ring reads as a progress bar instead, which is
 * what reliability actually is: how far along we are toward trusting the
 * number, saying nothing about how well anyone plays.
 *
 * Colour carries the same message as the `?` elsewhere, so the two agree: amber
 * and red while it is still filling, green once it passes the 60% mark.
 */
const PASS = 0.6;

function colourFor(value: number): string {
  if (value >= PASS) return "var(--success)";
  if (value >= 0.3) return "var(--amber)";
  return "var(--danger)";
}

export default function ReliabilityRing({
  value,
  size = 48,
}: {
  /** 0–1. */
  value: number;
  size?: number;
}) {
  const v = Math.min(1, Math.max(0, value));
  const pct = Math.round(v * 100);

  const stroke = Math.max(4, Math.round(size * 0.12));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const colour = colourFor(v);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Reliability ${pct} percent`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* The unfilled remainder, so the ring reads as a proportion. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - v)}
          /* Start at twelve o'clock rather than three. */
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span
        className="absolute font-semibold tabular-nums"
        style={{ fontSize: Math.max(10, Math.round(size * 0.28)), color: colour }}
      >
        {pct}
      </span>
    </span>
  );
}

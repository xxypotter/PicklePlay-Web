/**
 * A pickleball paddle and ball.
 *
 * Drawn rather than an emoji: 🏓 is a *table tennis* paddle — round, short
 * handle, solid ball — and reads wrong to anyone who plays. A pickleball paddle
 * is a broad flat face with a long handle, and the ball is perforated.
 */
export default function PaddleIcon({
  className = "",
  size = 24,
  /** Accessible name. Passed in so this stays usable from any tree. */
  label = "Pickleball",
}: {
  className?: string;
  size?: number;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      fill="none"
      role="img"
      aria-label={label}
    >
      {/* Paddle face: tall rounded rectangle, tilted like a held paddle. */}
      <g transform="rotate(-20 13 14)">
        <rect
          x="4.5"
          y="2.5"
          width="17"
          height="20"
          rx="6.5"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Handle with a grip band at the base. */}
        <rect
          x="10.5"
          y="22"
          width="5"
          height="8"
          rx="2.2"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="2"
        />
      </g>

      {/* Ball, with the holes that make it a pickleball. */}
      <circle cx="25" cy="24.5" r="5.5" fill="currentColor" fillOpacity="0.18" />
      <circle cx="25" cy="24.5" r="5.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="25" cy="22.2" r="0.95" fill="currentColor" />
      <circle cx="22.7" cy="25.4" r="0.95" fill="currentColor" />
      <circle cx="27.3" cy="25.4" r="0.95" fill="currentColor" />
    </svg>
  );
}

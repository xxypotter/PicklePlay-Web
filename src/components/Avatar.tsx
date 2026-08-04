/**
 * Player avatars.
 *
 * Three cases, in order: an uploaded image, one of the preset tiles, or — when
 * someone has never chosen — a colour derived from their name. The fallback is
 * deterministic rather than stored, so every existing player already has a
 * distinct avatar without a backfill or a decision to make at signup.
 */

/** Deliberately mid-tone so white initials read on all of them. */
export const PRESET_COLORS = [
  "#ff8f1f",
  "#07c160",
  "#3b82f6",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#eab308",
  "#ec4899",
];

/** Stable hash so a given name always lands on the same colour. */
function hashOf(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

export function defaultPresetFor(username: string): number {
  return hashOf(username.toLowerCase()) % PRESET_COLORS.length;
}

/**
 * Initials from word parts, not the first two characters.
 *
 * A group whose names share a prefix — dev_ana, dev_ben, dev_cara — would
 * otherwise every one of them read "DE", which defeats the point of an avatar.
 */
export function initialsOf(name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Avatar({
  username,
  avatar,
  size = 40,
  className = "",
}: {
  username: string;
  avatar?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size } as const;

  if (avatar?.startsWith("data:image/")) {
    return (
      // Data URLs can't go through next/image, and these are already resized
      // to ~160px on the client before upload.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt={username}
        style={style}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  const index = avatar?.startsWith("preset:")
    ? Number(avatar.slice(7)) % PRESET_COLORS.length
    : defaultPresetFor(username);

  return (
    <span
      aria-hidden
      style={{ ...style, background: PRESET_COLORS[index], fontSize: size * 0.38 }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold
        text-white ${className}`}
    >
      {initialsOf(username)}
    </span>
  );
}

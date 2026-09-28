"use client";

import { useT } from "@/lib/i18n/client";

/**
 * The box above a player picker. Filtering itself is matchPlayers(); this is
 * only the input, so every picker behaves the same.
 *
 * Enter never submits the surrounding form — on the create page it sits inside
 * one, and a stray Enter would create the session. With exactly one match,
 * Enter picks it instead, which is what the organizer was typing towards.
 */
export default function PlayerSearch({
  value,
  onChange,
  onPickOnly,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Called on Enter; the caller decides whether a single match is picked. */
  onPickOnly: () => void;
}) {
  const t = useT();
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="search"
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="field pr-11"
        placeholder={t("search.players")}
        aria-label={t("search.players")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onPickOnly();
          } else if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("search.clear")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm
            text-[var(--muted)] active:bg-[var(--surface-2)]"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

import type { T } from "@/lib/i18n/translate";
import type { PlayoffKind } from "./engine";

/** What a playoff game decides, in words. One description, used everywhere. */
export function playoffLabel(t: T, kind: PlayoffKind, place: number, leg: number): string {
  if (kind === "semi") {
    return place === 1
      ? t("match.semifinal", { index: leg })
      : t("swiss.label.semi", { from: place, to: place + 3, leg });
  }
  if (kind === "place") {
    if (place === 1) return t("match.gold");
    if (place === 3) return t("match.bronze");
    return t("swiss.label.place", { from: place, to: place + 1 });
  }
  if (kind === "series") return t("swiss.label.series", { from: place, to: place + 1, leg });
  return t("swiss.label.ladder", { from: place, to: place + 2, leg });
}

/** "2–1": wins and losses, a bye counted as a win. */
export const record = (wins: number, losses: number) => `${wins}–${losses}`;

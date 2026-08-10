/**
 * What a shared session link should say about itself.
 *
 * Pasting a link into a group chat used to produce a card reading "PicklePlay"
 * and nothing else, so the person who received it had to open it to find out
 * whether it was tonight, where, or whether there was still a place. The
 * summary below is what a chat app shows without anyone tapping anything.
 *
 * Split out from the page so it can be unit tested: the interesting parts are
 * the branches (full vs places left, upcoming vs finished), and those are
 * awkward to assert through a rendered <head>.
 */
import type { T } from "@/lib/i18n/translate";

export interface ShareableSession {
  title: string;
  startsAt: Date;
  location: string | null;
  courtNames: string[];
  maxPlayers: number;
  status: string;
  signedUp: number;
  completedMatches: number;
}

/**
 * The one-line description under a shared link's title.
 *
 * Written for someone who has not opened the app: when, where, and the single
 * fact that decides whether they act — is there room, or is it over.
 */
export function shareDescription(session: ShareableSession, t: T, locale: string): string {
  const when = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(session.startsAt);

  const where = session.location?.trim();
  const head = where ? t("share.summary", { when, where }) : when;

  if (session.status === "closed") {
    return `${head} · ${t("share.finished", { count: session.completedMatches })}`;
  }

  const courts = t.plural("card.courts", session.courtNames.length, {
    names: session.courtNames.join(", "),
  });

  const left = session.maxPlayers - session.signedUp;
  const places =
    left > 0 ? t.plural("share.spotsLeft", left, { count: left }) : t("share.full");

  return `${head} · ${t("share.spots", {
    count: session.signedUp,
    max: session.maxPlayers,
    courts,
  })} · ${places}`;
}

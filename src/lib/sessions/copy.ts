/**
 * What "copy this session" carries over.
 *
 * The setup, and only the setup: title, place, courts, capacity, format, notes,
 * whether it rates. Never the players — a new night is a new sign-up, and
 * whoever came last time has not said they are coming this time. Never the
 * date either: the source is in the past, so the form moves it to the coming
 * occurrence of the same weekday and time, in the browser (see `nextWeekly`).
 *
 * Pure, so the awkward cases below are tested rather than remembered.
 */

/** The formats the create form offers. Anything else is an old enum value. */
export const OFFERED_FORMATS = ["regular", "balanced", "gender", "fixed", "custom"] as const;

export const MAX_COURTS = 4;
export const PLAYERS_PER_COURT = 6;
const MIN_PLAYERS = 4;

export interface CopyableSession {
  title: string;
  location: string | null;
  startsAt: Date;
  courtNames: string[];
  maxPlayers: number;
  format: string;
  notes: string | null;
  rated: boolean;
  isPrivate: boolean;
}

/** Plain values, safe to hand from the server page to the client form. */
export interface CopySource {
  title: string;
  location: string;
  /** The source's start, as ISO. The form works out the new date from it. */
  startsAt: string;
  courts: string;
  maxPlayers: number;
  format: (typeof OFFERED_FORMATS)[number];
  notes: string;
  rated: boolean;
  isPrivate: boolean;
}

export function copySourceFrom(
  session: CopyableSession,
  /** May this user create a private session? Only then does "private" carry over. */
  canMakePrivate: boolean,
): CopySource {
  const courtNames = session.courtNames.slice(0, MAX_COURTS);
  const seatCap = Math.max(1, courtNames.length) * PLAYERS_PER_COURT;

  return {
    title: session.title,
    location: session.location ?? "",
    startsAt: session.startsAt.toISOString(),
    courts: courtNames.join(", "),
    /*
     * Clamped to what the form will accept. The cap can legitimately end a
     * night higher than the courts allow — an organizer adding a latecomer
     * raises it to fit — and copying that as-is would open the form already
     * showing an error the organizer did not make.
     */
    maxPlayers: Math.min(Math.max(session.maxPlayers, MIN_PLAYERS), seatCap),
    // An old session may carry a format the form no longer offers.
    format: (OFFERED_FORMATS as readonly string[]).includes(session.format)
      ? (session.format as CopySource["format"])
      : "regular",
    notes: session.notes ?? "",
    rated: session.rated,
    // Private is the super admin's alone; anyone else's copy is simply public.
    isPrivate: canMakePrivate && session.isPrivate,
  };
}

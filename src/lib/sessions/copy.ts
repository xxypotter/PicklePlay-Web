/**
 * What "copy this session" carries over.
 *
 * Two ways to copy. **Copy to a new session** takes the setup only: title,
 * place, courts, capacity, format, notes, whether it rates — a new night is a
 * new sign-up. **Copy with players** (v1.7) is for a standing group that plays
 * as it did last week: everyone signed up comes too, in the same order, plus
 * the Mini MLP teams and lineups or the fixed pairs. Never the date: the source
 * is in the past, so the form moves it to the coming occurrence of the same
 * weekday and time, in the browser (see `nextWeekly`).
 *
 * Pure, so the awkward cases below are tested rather than remembered.
 */
import { validateTeams } from "@/lib/mlp/rules";

/** The formats the create form offers. Anything else is an old enum value. */
export const OFFERED_FORMATS = ["regular", "balanced", "gender", "fixed", "custom", "mlp"] as const;

import { maxCourtsFor, PLAYERS_PER_COURT } from "./limits";
export { MAX_COURTS, PLAYERS_PER_COURT } from "./limits";
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
  /** Copy with players only. The source id, so Create can re-read its teams. */
  copyFrom?: string;
  /** Copy with players only: player ids, confirmed first, then the waitlist. */
  players?: string[];
  /** Mini MLP source: its teams, with every lineup spelled out. */
  teams?: CopiedTeam[];
  /** Fixed-partner source: its pairs. */
  pairs?: Array<[string, string]>;
}

export interface CopiedTeam {
  name: string;
  m1: string; m2: string; w1: string; w2: string;
  women1: string; women2: string; men1: string; men2: string;
}

export interface CopyableSignup {
  playerId: string;
  state: "in" | "waitlist" | "out";
  waitlistPos: number | null;
  createdAt: Date;
}

/**
 * Everyone signed up last time, in the order they would be seated: confirmed
 * players by when they joined, then the waitlist in queue order. Players marked
 * absent on the night are still signed up, so they come too — the organizer
 * can untick them. Anyone who opted out said they weren't coming, and doesn't.
 */
export function copyRoster(rows: readonly CopyableSignup[]): string[] {
  const confirmed = rows
    .filter((r) => r.state === "in")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const waiting = rows
    .filter((r) => r.state === "waitlist")
    .sort((a, b) => (a.waitlistPos ?? Infinity) - (b.waitlistPos ?? Infinity));
  return [...confirmed, ...waiting].map((r) => r.playerId);
}

/**
 * The players Create will mark in: the first `maxPlayers` picked. The rest
 * queue, so they can't be in a team or a pair yet.
 */
const confirmedOf = (invited: readonly string[], maxPlayers: number) =>
  new Set(invited.slice(0, maxPlayers));

/**
 * Whether copied Mini MLP teams can be kept. All or nothing: a draw needs every
 * team whole, so one missing player means setting the teams up again. The same
 * validation a saved setup gets, against the players the new session confirms.
 */
export function teamsCarryOver(
  teams: readonly CopiedTeam[] | undefined,
  format: string,
  maxPlayers: number,
  invited: readonly string[],
): boolean {
  if (!teams?.length || format !== "mlp" || maxPlayers !== teams.length * 4) return false;
  return validateTeams([...teams], confirmedOf(invited, maxPlayers), teams.length);
}

/** Copied fixed pairs whose two players are both confirmed; the rest are dropped. */
export function pairsCarryOver(
  pairs: ReadonlyArray<readonly [string, string]> | undefined,
  format: string,
  maxPlayers: number,
  invited: readonly string[],
): Array<[string, string]> {
  if (format !== "fixed" || !pairs) return [];
  const confirmed = confirmedOf(invited, maxPlayers);
  const used = new Set<string>();
  const kept: Array<[string, string]> = [];
  for (const [a, b] of pairs) {
    if (a === b || !confirmed.has(a) || !confirmed.has(b) || used.has(a) || used.has(b)) continue;
    used.add(a); used.add(b);
    kept.push([a, b]);
  }
  return kept;
}

export function copySourceFrom(
  session: CopyableSession,
  /** May this user create a private session? Only then does "private" carry over. */
  canMakePrivate: boolean,
): CopySource {
  const courtNames = session.courtNames.slice(0, maxCourtsFor(session.format));
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

import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { players } from "@/lib/db/schema";
import { teamPlayers } from "@/lib/sessions/medal";
import type { RoundPlayer } from "@/lib/sessions/queries";
import {
  finalPlaces, maxSwissRounds, suggestedRounds, swissStandings, winnerOf,
  type PairKey, type PlayoffKind, type SwissRow,
} from "./engine";
import { loadSwissHistory } from "./history";
import { record } from "./labels";

export interface SwissGameView {
  matchId: string;
  a: PairKey;
  b: PairKey;
  scoreA: number | null;
  scoreB: number | null;
  status: "scheduled" | "completed" | "void";
  winner: PairKey | null;
  /** Each pair's record going into the game. Different only when a pair moved groups. */
  recordA: string;
  recordB: string;
}

export interface SwissRoundView {
  number: number;
  games: SwissGameView[];
  bye: PairKey | null;
  byeRecord: string | null;
}

export interface SwissPlayoffView extends Omit<SwissGameView, "recordA" | "recordB"> {
  wave: 1 | 2;
  kind: PlayoffKind;
  place: number;
  leg: number;
}

export type SwissPhase = "setup" | "swiss" | "playoffs" | "finals" | "done";

export interface SwissView {
  seeded: boolean;
  pairs: Record<PairKey, RoundPlayer[]>;
  rounds: SwissRoundView[];
  standings: Array<SwissRow & { rank: number }>;
  playoffs: SwissPlayoffView[];
  /** Best first, once every playoff game is decided. */
  places: PairKey[] | null;
  pairCount: number;
  suggested: number;
  max: number;
  phase: SwissPhase;
  /** The current stage still has games without a result. */
  open: boolean;
}

/** Everything the Swiss screens show, from the stored rounds. */
export async function getSwissView(sessionId: string, seeded: boolean): Promise<SwissView> {
  const history = await loadSwissHistory(getDb(), sessionId);
  const { keys, swissRounds, playoffs } = history;

  const ids = [...new Set(keys.flatMap(teamPlayers))];
  const people = ids.length
    ? await getDb().select({ id: players.id, username: players.username, avatar: players.avatar })
      .from(players).where(inArray(players.id, ids))
    : [];
  const person = (id: string): RoundPlayer => {
    const p = people.find((x) => x.id === id);
    return { id, username: p?.username ?? "?", avatar: p?.avatar ?? null };
  };
  const pairs = Object.fromEntries(keys.map((k) => [k, teamPlayers(k).map(person)]));

  const rounds: SwissRoundView[] = swissRounds.map((round, i) => {
    // Records going into this round: everything before it.
    const before = new Map(swissStandings(keys, swissRounds.slice(0, i)).map((r) => [r.key, record(r.wins, r.losses)]));
    return {
      number: round.number,
      bye: round.bye,
      byeRecord: round.bye ? before.get(round.bye) ?? null : null,
      games: round.games.map((g) => ({
        matchId: g.matchId, a: g.a, b: g.b, scoreA: g.scoreA, scoreB: g.scoreB, status: g.status,
        winner: winnerOf(g), recordA: before.get(g.a) ?? "", recordB: before.get(g.b) ?? "",
      })),
    };
  });

  const table = swissStandings(keys, swissRounds);
  const ranked = table.map((r) => r.key);
  const playoffViews: SwissPlayoffView[] = playoffs.map((g) => ({
    matchId: g.matchId, wave: g.wave, kind: g.kind, place: g.place, leg: g.leg,
    a: g.a, b: g.b, scoreA: g.scoreA, scoreB: g.scoreB, status: g.status, winner: winnerOf(g),
  }));
  const places = history.playoffWaves === 2 ? finalPlaces(ranked, playoffs) : null;

  const phase: SwissPhase = swissRounds.length === 0 ? "setup"
    : history.playoffWaves === 0 ? "swiss"
      : history.playoffWaves === 1 ? "playoffs"
        : places ? "done" : "finals";
  const open = phase === "swiss"
    ? swissRounds.some((r) => r.games.some((g) => g.status === "scheduled"))
    : phase === "playoffs" || phase === "finals"
      ? playoffViews.filter((g) => g.wave === history.playoffWaves).some((g) => g.winner === null)
      : false;

  return {
    seeded,
    pairs,
    rounds,
    standings: table.map((r, i) => ({ ...r, rank: i + 1 })),
    playoffs: playoffViews,
    places,
    pairCount: keys.length,
    suggested: suggestedRounds(keys.length),
    max: maxSwissRounds(keys.length),
    phase,
    open,
  };
}

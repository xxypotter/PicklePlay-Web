import { describe, expect, it } from "vitest";
import type { CurrentRound, RoundMatch, RoundPlayer } from "./queries";
import { bracketFrom, teamRowsFrom } from "./team-view";

const p = (id: string): RoundPlayer => ({ id, username: id, avatar: null });

const match = (
  a: [string, string],
  b: [string, string],
  scoreA: number | null = null,
  scoreB: number | null = null,
  voided = false,
): RoundMatch => ({
  id: `${a.join("")}-${b.join("")}`,
  courtNo: 1,
  courtLabel: "1",
  teamA: [p(a[0]), p(a[1])],
  teamB: [p(b[0]), p(b[1])],
  scoreA,
  scoreB,
  completed: scoreA !== null && scoreB !== null,
  voided,
  stageLabel: null,
});

const round = (
  index: number,
  stage: CurrentRound["stage"],
  matches: RoundMatch[],
): CurrentRound => ({ id: `r${index}`, index, stage, matches });

const NO_DELTAS = new Map<string, number | null>();

/** Four teams; T1 beats everyone, T4 loses to everyone. */
const robin: CurrentRound[] = [
  round(1, "robin", [match(["a1", "a2"], ["d1", "d2"], 11, 2), match(["b1", "b2"], ["c1", "c2"], 11, 8)]),
  round(2, "robin", [match(["a1", "a2"], ["c1", "c2"], 11, 5), match(["b1", "b2"], ["d1", "d2"], 11, 4)]),
  round(3, "robin", [match(["a1", "a2"], ["b1", "b2"], 11, 9), match(["c1", "c2"], ["d1", "d2"], 11, 6)]),
];

describe("teamRowsFrom", () => {
  it("counts a pair as one competitor, however the sides were listed", () => {
    const rows = teamRowsFrom(robin, NO_DELTAS);
    expect(rows).toHaveLength(4);
    expect(rows[0].players.map((x) => x.id)).toEqual(["a1", "a2"]);
    expect([rows[0].wins, rows[0].losses]).toEqual([3, 0]);
    expect(rows.at(-1)!.players.map((x) => x.id)).toEqual(["d1", "d2"]);
  });

  it("ranks on record while no medal round has been played", () => {
    const rows = teamRowsFrom(robin, NO_DELTAS);
    expect(rows.map((r) => r.team.split("|")[0])).toEqual(["a1", "b1", "c1", "d1"]);
    expect(rows.every((r) => r.placement === null)).toBe(true);
  });

  it("ranks on the bracket once the finals decide it", () => {
    /*
     * The case from a real night: the team with the best record lost its
     * semi-final and finished fourth. A table that still gave it the gold medal
     * would contradict the bracket printed directly above it.
     */
    const withMedals: CurrentRound[] = [
      ...robin,
      round(4, "semifinal", [
        match(["a1", "a2"], ["d1", "d2"], 5, 11), // top seed is knocked out
        match(["b1", "b2"], ["c1", "c2"], 11, 9),
      ]),
      round(5, "final", [
        match(["d1", "d2"], ["b1", "b2"], 7, 11), // gold
        match(["a1", "a2"], ["c1", "c2"], 8, 11), // bronze
      ]),
    ];

    const rows = teamRowsFrom(withMedals, NO_DELTAS);
    expect(rows.map((r) => r.placement)).toEqual([1, 2, 3, 4]);
    expect(rows[0].players.map((x) => x.id)).toEqual(["b1", "b2"]); // gold
    expect(rows[1].players.map((x) => x.id)).toEqual(["d1", "d2"]); // silver
    expect(rows[2].players.map((x) => x.id)).toEqual(["c1", "c2"]); // bronze
    expect(rows[3].players.map((x) => x.id)).toEqual(["a1", "a2"]); // best record, 4th
  });

  it("keeps each player's rating movement separate", () => {
    // A pair has no rating of its own; summing two would invent a number.
    const deltas = new Map<string, number | null>([
      ["a1", 0.12],
      ["a2", -0.04],
    ]);
    const rows = teamRowsFrom(robin, deltas);
    const top = rows[0];
    expect(top.deltas).toEqual([
      { id: "a1", username: "a1", delta: 0.12 },
      { id: "a2", username: "a2", delta: -0.04 },
    ]);
  });

  it("ignores voided matches but keeps the team in the table", () => {
    const rows = teamRowsFrom(
      [round(1, "robin", [match(["a1", "a2"], ["b1", "b2"], 11, 2, true)])],
      NO_DELTAS,
    );
    expect(rows).toHaveLength(0);
  });

  it("lists a team drawn into an unplayed semi-final", () => {
    const rows = teamRowsFrom(
      [round(1, "semifinal", [match(["a1", "a2"], ["b1", "b2"])])],
      NO_DELTAS,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.wins === 0 && r.losses === 0)).toBe(true);
  });
});

describe("bracketFrom", () => {
  it("is null for a night with no medal round", () => {
    expect(bracketFrom(robin)).toBeNull();
  });

  it("labels by court order, which is what the draw is stored as", () => {
    const b = bracketFrom([
      ...robin,
      round(4, "semifinal", [
        match(["a1", "a2"], ["d1", "d2"], 11, 3),
        match(["b1", "b2"], ["c1", "c2"], 11, 9),
      ]),
      round(5, "final", [
        match(["a1", "a2"], ["b1", "b2"], 11, 7),
        match(["d1", "d2"], ["c1", "c2"], 11, 6),
      ]),
    ])!;

    expect(b.semis.map((m) => m.label)).toEqual(["semi1", "semi2"]);
    expect(b.finals.map((m) => m.label)).toEqual(["gold", "bronze"]);
  });

  it("reports semi-finals with no finals drawn yet", () => {
    const b = bracketFrom([
      ...robin,
      round(4, "semifinal", [
        match(["a1", "a2"], ["d1", "d2"]),
        match(["b1", "b2"], ["c1", "c2"]),
      ]),
    ])!;

    expect(b.semis).toHaveLength(2);
    expect(b.finals).toHaveLength(0);
    expect(b.semis.every((m) => !m.completed)).toBe(true);
  });
});

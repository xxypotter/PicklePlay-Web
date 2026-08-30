import { describe, expect, it } from "vitest";
import {
  finals,
  semiFinals,
  teamKey,
  teamPlayers,
  teamStandings,
  type PlayedMatch,
} from "./medal";

/** Four fixed pairs, named so the assertions read like a draw sheet. */
const A = ["a1", "a2"] as const;
const B = ["b1", "b2"] as const;
const C = ["c1", "c2"] as const;
const D = ["d1", "d2"] as const;
const E = ["e1", "e2"] as const;

const game = (
  x: readonly [string, string],
  y: readonly [string, string],
  scoreA: number,
  scoreB: number,
): PlayedMatch => ({ a1: x[0], a2: x[1], b1: y[0], b2: y[1], scoreA, scoreB });

const key = (t: readonly [string, string]) => teamKey(t[0], t[1]);

describe("teamKey", () => {
  it("is the same whichever way round the pair is given", () => {
    // Team A of one match is team B of the next; without this the same pair
    // would be two rows in the table and neither would be right.
    expect(teamKey("z", "a")).toBe(teamKey("a", "z"));
    expect(teamPlayers(teamKey("z", "a"))).toEqual(["a", "z"]);
  });
});

describe("teamStandings", () => {
  it("counts a pair's results whichever side of the net they were on", () => {
    const table = teamStandings([game(A, B, 11, 5), game(B, A, 11, 9)]);
    expect(table).toHaveLength(2);
    expect(table.map((r) => [r.wins, r.losses])).toEqual([
      [1, 1],
      [1, 1],
    ]);
    // A: scored 11 + 9, conceded 5 + 11. B is the mirror.
    const a = table.find((r) => r.team === key(A))!;
    expect([a.pointsFor, a.pointsAgainst]).toEqual([20, 16]);
  });

  it("ranks on wins, then point difference", () => {
    const table = teamStandings([
      game(A, B, 11, 2), // A +9
      game(C, D, 11, 9), // C +2
      game(A, C, 5, 11), // C +6
      game(B, D, 11, 7), // B +4
    ]);
    // C: 2 wins. A: 1 win (+9-6=+3). B: 1 win (-9+4=-5). D: 0 wins.
    expect(table.map((r) => r.team)).toEqual([key(C), key(A), key(B), key(D)]);
  });

  it("breaks a dead tie deterministically rather than on row order", () => {
    // Same wins, same difference, same points scored — the order still has to
    // be stable, or two organizers seeding the same night get two brackets.
    const one = teamStandings([game(A, B, 11, 9), game(B, A, 11, 9)]);
    const two = teamStandings([game(B, A, 11, 9), game(A, B, 11, 9)]);
    expect(one.map((r) => r.team)).toEqual(two.map((r) => r.team));
  });
});

describe("semiFinals", () => {
  it("pairs first with fourth and second with third", () => {
    const table = teamStandings([
      game(A, B, 11, 0),
      game(A, C, 11, 0),
      game(A, D, 11, 0), // A: 3 wins
      game(B, C, 11, 0),
      game(B, D, 11, 0), // B: 2 wins
      game(C, D, 11, 0), // C: 1 win, D: 0
    ]);
    expect(table.map((r) => r.team)).toEqual([key(A), key(B), key(C), key(D)]);

    const bracket = semiFinals(table)!;
    expect(bracket[0]).toEqual([...A, ...D]); // 1 v 4
    expect(bracket[1]).toEqual([...B, ...C]); // 2 v 3
  });

  it("takes only the top four when more teams played", () => {
    const table = teamStandings([
      game(A, B, 11, 0),
      game(A, C, 11, 0),
      game(A, D, 11, 0),
      game(A, E, 11, 0), // A: 4
      game(B, C, 11, 0),
      game(B, D, 11, 0),
      game(B, E, 11, 0), // B: 3
      game(C, D, 11, 0),
      game(C, E, 11, 0), // C: 2
      game(D, E, 11, 0), // D: 1, E: 0
    ]);
    const bracket = semiFinals(table)!;
    const inBracket = new Set(bracket.flat());
    expect(inBracket.has("e1")).toBe(false);
    expect(inBracket.size).toBe(8);
  });

  it("refuses with fewer than four teams", () => {
    expect(semiFinals(teamStandings([game(A, B, 11, 5), game(A, C, 11, 5)]))).toBeNull();
  });
});

describe("finals", () => {
  it("sends the two winners to gold and the two losers to bronze", () => {
    const [gold, bronze] = finals([game(A, D, 11, 4), game(B, C, 7, 11)]);
    expect(gold).toEqual([...A, ...C]); // A beat D, C beat B
    expect(bronze).toEqual([...D, ...B]); // the two who lost
  });

  it("reads the result, not the seeding — an upset carries through", () => {
    // The fourth seed beats the first. Gold must follow who actually won.
    const [gold, bronze] = finals([game(A, D, 5, 11), game(B, C, 11, 3)]);
    expect(gold).toEqual([...D, ...B]);
    expect(bronze).toEqual([...A, ...C]);
  });

  it("keeps the first semi-final's side of the draw on court one", () => {
    const [gold] = finals([game(A, D, 11, 4), game(B, C, 11, 4)]);
    // Winner of semi 1 is team A of the gold final, so the bracket reads
    // top-down the way it was drawn.
    expect(gold.slice(0, 2)).toEqual([...A]);
  });
});

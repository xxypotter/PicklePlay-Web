import { describe, expect, it } from "vitest";
import {
  bestPartner,
  favouriteOpponent,
  mostPlayedWith,
  nemesis,
  summariseRecord,
  type PlayedMatch,
} from "./record";

const ME = "me";
let clock = 0;
const match = (
  teamA: [string, string],
  teamB: [string, string],
  scoreA: number | null,
  scoreB: number | null,
): PlayedMatch => ({
  matchId: `m${clock}`,
  playedAt: new Date(2026, 0, 1, 12, clock++),
  a1: teamA[0],
  a2: teamA[1],
  b1: teamB[0],
  b2: teamB[1],
  scoreA,
  scoreB,
});

describe("reading a match from the player's side", () => {
  it("works whichever team they were on", () => {
    const onA = summariseRecord(ME, [match([ME, "pat"], ["x", "y"], 11, 6)]).matches[0];
    expect(onA).toMatchObject({ partnerId: "pat", scoreFor: 11, scoreAgainst: 6, won: true });

    const onB = summariseRecord(ME, [match(["x", "y"], [ME, "pat"], 11, 6)]).matches[0];
    // Same partner, same result — the scores belong to the team, not the column.
    expect(onB).toMatchObject({ partnerId: "pat", scoreFor: 6, scoreAgainst: 11, won: false });
  });

  it("ignores matches they weren't in", () => {
    expect(summariseRecord(ME, [match(["a", "b"], ["c", "d"], 11, 3)]).played).toBe(0);
  });

  it("ignores results that were never entered", () => {
    // A scheduled-but-unplayed match must not count as a loss.
    const r = summariseRecord(ME, [match([ME, "pat"], ["x", "y"], null, null)]);
    expect(r.played).toBe(0);
    expect(r.lost).toBe(0);
  });
});

describe("totals", () => {
  it("counts wins, losses, points and margins", () => {
    const r = summariseRecord(ME, [
      match([ME, "pat"], ["x", "y"], 11, 6),
      match([ME, "pat"], ["x", "y"], 8, 11),
    ]);
    expect(r).toMatchObject({ played: 2, won: 1, lost: 1, pointsFor: 19, pointsAgainst: 17 });
    expect(r.winRate).toBeCloseTo(0.5, 6);
    expect(r.biggestWin?.margin).toBe(5);
    expect(r.heaviestLoss?.margin).toBe(-3);
  });

  it("tracks the longest winning run, not just the current one", () => {
    const r = summariseRecord(ME, [
      match([ME, "a"], ["x", "y"], 11, 1),
      match([ME, "a"], ["x", "y"], 11, 2),
      match([ME, "a"], ["x", "y"], 11, 3),
      match([ME, "a"], ["x", "y"], 4, 11), // run broken
      match([ME, "a"], ["x", "y"], 11, 5),
    ]);
    expect(r.longestWinStreak).toBe(3);
  });

  it("has no win rate before anything is played", () => {
    expect(summariseRecord(ME, []).winRate).toBeNull();
  });
});

describe("head to head", () => {
  const withPat = [
    match([ME, "pat"], ["x", "y"], 11, 4),
    match([ME, "pat"], ["x", "y"], 11, 5),
    match([ME, "pat"], ["x", "y"], 11, 6),
  ];
  const withSam = [
    match([ME, "sam"], ["x", "y"], 3, 11),
    match([ME, "sam"], ["x", "y"], 4, 11),
    match([ME, "sam"], ["x", "y"], 5, 11),
  ];

  it("separates partners from opponents", () => {
    const r = summariseRecord(ME, [...withPat, ...withSam]);
    expect(r.partners.map((p) => p.playerId).sort()).toEqual(["pat", "sam"]);
    expect(r.opponents.map((o) => o.playerId).sort()).toEqual(["x", "y"]);
  });

  it("picks the partner you actually win with", () => {
    const r = summariseRecord(ME, [...withPat, ...withSam]);
    expect(bestPartner(r.partners)?.playerId).toBe("pat");
  });

  it("finds who has your number and who doesn't", () => {
    const r = summariseRecord(ME, [
      // Beaten by "boss" every time, beats "soft" every time.
      match([ME, "a"], ["boss", "n1"], 5, 11),
      match([ME, "a"], ["boss", "n2"], 6, 11),
      match([ME, "a"], ["boss", "n3"], 7, 11),
      match([ME, "a"], ["soft", "n4"], 11, 5),
      match([ME, "a"], ["soft", "n5"], 11, 6),
      match([ME, "a"], ["soft", "n6"], 11, 7),
    ]);
    expect(nemesis(r.opponents)?.playerId).toBe("boss");
    expect(favouriteOpponent(r.opponents)?.playerId).toBe("soft");
  });

  it("stays quiet until there's enough to say", () => {
    // Two games together is a coincidence, and calling it a "best partner"
    // would be the screen making things up.
    const r = summariseRecord(ME, [
      match([ME, "pat"], ["x", "y"], 11, 4),
      match([ME, "pat"], ["x", "y"], 11, 5),
    ]);
    expect(bestPartner(r.partners)).toBeNull();
    expect(nemesis(r.opponents)).toBeNull();
  });

  it("breaks a tie toward whoever you've played more", () => {
    const r = summariseRecord(ME, [
      match([ME, "often"], ["x", "y"], 11, 1),
      match([ME, "often"], ["x", "y"], 11, 2),
      match([ME, "often"], ["x", "y"], 11, 3),
      match([ME, "often"], ["x", "y"], 11, 4),
      match([ME, "rare"], ["x", "y"], 11, 5),
      match([ME, "rare"], ["x", "y"], 11, 6),
      match([ME, "rare"], ["x", "y"], 11, 7),
    ]);
    // Both are 100%; the one with more evidence wins.
    expect(bestPartner(r.partners)?.playerId).toBe("often");
  });

  it("counts most-played regardless of results", () => {
    const r = summariseRecord(ME, [
      match([ME, "pat"], ["x", "y"], 11, 4),
      match([ME, "pat"], ["x", "y"], 2, 11),
      match([ME, "pat"], ["x", "y"], 11, 9),
      match([ME, "sam"], ["x", "y"], 11, 4),
      match([ME, "sam"], ["x", "y"], 11, 5),
      match([ME, "sam"], ["x", "y"], 11, 6),
      match([ME, "sam"], ["x", "y"], 11, 7),
    ]);
    // sam has more games; wins don't enter into it.
    expect(mostPlayedWith(r.partners)?.playerId).toBe("sam");
  });

  it("won't name a most-played partner off one game", () => {
    // The screen promises everything on it comes from three games or more.
    const r = summariseRecord(ME, [match([ME, "pat"], ["x", "y"], 11, 4)]);
    expect(mostPlayedWith(r.partners)).toBeNull();
  });
});

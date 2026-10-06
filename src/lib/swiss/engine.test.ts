import { describe, expect, it } from "vitest";
import {
  finalPlaces, firstRound, maxSwissRounds, nextRound, playoffShape, playoffWave1, playoffWave2,
  suggestedRounds, swissStandings, validPairCount, validSwissConfig,
  type Draw, type PairKey, type PlayedPlayoff, type PlayoffGame, type SwissRound,
} from "./engine";

const keys = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, "0")}`);

/** A small deterministic generator, so a failing trial can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Score a draw: `aWins` decides each game; the loser scores 0–9. */
const play = (draw: Draw, aWins: (a: PairKey, b: PairKey) => boolean, loser = () => 5): SwissRound => ({
  bye: draw.bye,
  games: draw.games.map(({ a, b }) => {
    const l = loser();
    return aWins(a, b)
      ? { a, b, scoreA: 11, scoreB: l, status: "completed" as const }
      : { a, b, scoreA: l, scoreB: 11, status: "completed" as const };
  }),
});

const edges = (rounds: SwissRound[]) => rounds.flatMap((r) => r.games.map((g) => [g.a, g.b].sort().join("#")));

describe("Swiss configuration", () => {
  it("accepts 4–6 courts and 12–24 players, and 6–12 pairs", () => {
    expect(validSwissConfig(4, 16)).toBe(true);
    expect(validSwissConfig(6, 24)).toBe(true);
    expect(validSwissConfig(3, 16)).toBe(false);
    expect(validSwissConfig(7, 16)).toBe(false);
    expect(validSwissConfig(4, 10)).toBe(false);
    expect(validSwissConfig(4, 26)).toBe(false);
    expect([5, 6, 12, 13].map(validPairCount)).toEqual([false, true, true, false]);
    expect([6, 7, 8, 9, 12].map(suggestedRounds)).toEqual([3, 3, 3, 4, 4]);
    expect([6, 7, 8].map(maxSwissRounds)).toEqual([5, 7, 7]);
  });
});

describe("round 1", () => {
  it("plays the top half against the bottom half, in order", () => {
    expect(firstRound(keys(8))).toEqual({
      bye: null,
      games: [{ a: "p01", b: "p05" }, { a: "p02", b: "p06" }, { a: "p03", b: "p07" }, { a: "p04", b: "p08" }],
    });
  });
  it("gives the last pair in the order the bye on an odd night", () => {
    expect(firstRound(keys(7))).toEqual({
      bye: "p07",
      games: [{ a: "p01", b: "p04" }, { a: "p02", b: "p05" }, { a: "p03", b: "p06" }],
    });
  });
});

describe("standings", () => {
  it("counts a bye as a win with no points, and Buchholz as opponents' wins", () => {
    const rounds: SwissRound[] = [
      { bye: "p03", games: [{ a: "p01", b: "p02", scoreA: 11, scoreB: 4, status: "completed" }] },
      { bye: "p01", games: [{ a: "p02", b: "p03", scoreA: 11, scoreB: 9, status: "completed" }] },
    ];
    const table = swissStandings(["p01", "p02", "p03"], rounds);
    // p01: 2 wins (game + bye), Buchholz = p02's 1 win. p02: 1–1, Buchholz 2 + 1.
    expect(table.map((r) => [r.key, r.wins, r.losses, r.byes, r.buchholz, r.pointsFor - r.pointsAgainst])).toEqual([
      ["p01", 2, 0, 1, 1, 7],
      ["p02", 1, 1, 0, 3, -5],
      ["p03", 1, 1, 1, 1, -2],
    ]);
  });
  it("ignores unscored and voided games", () => {
    const table = swissStandings(["p01", "p02"], [{ bye: null, games: [
      { a: "p01", b: "p02", scoreA: null, scoreB: null, status: "scheduled" },
      { a: "p01", b: "p02", scoreA: 11, scoreB: 3, status: "void" },
    ] }]);
    expect(table.every((r) => r.wins === 0 && r.losses === 0 && r.buchholz === 0)).toBe(true);
  });
  it("breaks equal wins by Buchholz, then point difference", () => {
    const rounds: SwissRound[] = [{ bye: null, games: [
      { a: "p01", b: "p02", scoreA: 11, scoreB: 9, status: "completed" },
      { a: "p03", b: "p04", scoreA: 11, scoreB: 0, status: "completed" },
    ] }, { bye: null, games: [
      { a: "p01", b: "p03", scoreA: 11, scoreB: 9, status: "completed" },
      { a: "p02", b: "p04", scoreA: 11, scoreB: 0, status: "completed" },
    ] }];
    // p02 and p03 are both 1–1; p03's opponents won 2 + 0, p02's 2 + 0 — equal —
    // so point difference decides: p03 +9, p02 +9 → points scored, both 20 → key.
    expect(swissStandings(keys(4), rounds).map((r) => r.key)).toEqual(["p01", "p02", "p03", "p04"]);
  });
});

describe("pairing", () => {
  it("pairs highest against lowest inside a record group, CS-style", () => {
    // Round 1 by seed; the top four all win, with margins that rank them 1..4.
    const r1: SwissRound = { bye: null, games: [
      { a: "p01", b: "p05", scoreA: 11, scoreB: 0, status: "completed" },
      { a: "p02", b: "p06", scoreA: 11, scoreB: 1, status: "completed" },
      { a: "p03", b: "p07", scoreA: 11, scoreB: 2, status: "completed" },
      { a: "p04", b: "p08", scoreA: 11, scoreB: 3, status: "completed" },
    ] };
    expect(nextRound(keys(8), [r1])).toEqual({ bye: null, games: [
      { a: "p01", b: "p04" }, { a: "p02", b: "p03" }, { a: "p08", b: "p05" }, { a: "p07", b: "p06" },
    ] });
  });

  it("moves the nearest pair across groups when a group is odd", () => {
    // Six pairs: three 1–0, three 0–1 after round 1. One game has to cross.
    const r1 = play(firstRound(keys(6)), () => true, (() => { let i = 0; return () => i++; })());
    const draw = nextRound(keys(6), [r1])!;
    const wins = new Map(swissStandings(keys(6), [r1]).map((r) => [r.key, r.wins]));
    const crossing = draw.games.filter((g) => wins.get(g.a) !== wins.get(g.b));
    expect(crossing).toHaveLength(1);
    // The nearest crossing would be 3rd v 4th, but those two met in round 1
    // (the biggest winner's margin is the worst loser's), so it is 3rd v 5th.
    const table = swissStandings(keys(6), [r1]).map((r) => r.key);
    expect(r1.games.some((g) => [g.a, g.b].sort().join() === [table[2], table[3]].sort().join())).toBe(true);
    expect(crossing[0]).toEqual({ a: table[2], b: table[4] });
  });

  it.each([6, 7, 8, 9, 10, 11, 12])("%i pairs: no rematch, one game or bye each, never a second bye", (n) => {
    for (let trial = 0; trial < 150; trial++) {
      const random = rng(n * 1000 + trial);
      const order = [...keys(n)].sort(() => random() - 0.5);
      const rounds: SwissRound[] = [play(firstRound(order), () => random() < 0.5, () => Math.floor(random() * 10))];
      for (let r = 1; r < suggestedRounds(n) + 1; r++) {
        const draw = nextRound(keys(n), rounds);
        expect(draw, `trial ${trial} round ${r + 1}`).not.toBeNull();
        const seen = [...draw!.games.flatMap((g) => [g.a, g.b]), ...(draw!.bye ? [draw!.bye] : [])];
        expect(new Set(seen).size).toBe(n);
        expect(seen).toHaveLength(n);
        rounds.push(play(draw!, () => random() < 0.5, () => Math.floor(random() * 10)));
      }
      const all = edges(rounds);
      expect(new Set(all).size, `trial ${trial}`).toBe(all.length);
      const byes = rounds.map((r) => r.bye).filter(Boolean);
      expect(byes.length).toBe(n % 2 ? rounds.length : 0);
      expect(new Set(byes).size).toBe(byes.length);
    }
  });

  it("eight pairs over three rounds always end 3–0, three 2–1, three 1–2, 0–3", () => {
    for (let trial = 0; trial < 300; trial++) {
      const random = rng(trial + 7);
      const rounds: SwissRound[] = [play(firstRound(keys(8)), () => random() < 0.5)];
      for (let r = 1; r < 3; r++) {
        const draw = nextRound(keys(8), rounds)!;
        const wins = new Map(swissStandings(keys(8), rounds).map((row) => [row.key, row.wins]));
        // Every game is between equal records: the groups are always even.
        expect(draw.games.every((g) => wins.get(g.a) === wins.get(g.b))).toBe(true);
        rounds.push(play(draw, () => random() < 0.5));
      }
      const records = swissStandings(keys(8), rounds).map((r) => r.wins).sort().reverse();
      expect(records).toEqual([3, 2, 2, 2, 1, 1, 1, 0]);
    }
  });

  it("gives each bye to the lowest-ranked pair still without one", () => {
    const random = rng(42);
    const rounds: SwissRound[] = [play(firstRound(keys(7)), () => random() < 0.5)];
    const draw = nextRound(keys(7), rounds)!;
    const table = swissStandings(keys(7), rounds).map((r) => r.key);
    const eligible = [...table].reverse().filter((k) => k !== rounds[0].bye);
    expect(draw.bye).toBe(eligible[0]);
  });

  it.each([6, 7, 8, 9, 10, 11, 12])("%i pairs: looking one round ahead keeps a draw available far past any real night", (n) => {
    // Without the look-ahead, six pairs could be stuck after three rounds with
    // two unplayed triangles. With it, 6–10 pairs can finish a full round robin.
    const target = Math.min(maxSwissRounds(n), 9);
    for (let trial = 0; trial < 25; trial++) {
      const random = rng(trial * 97 + n);
      const rounds: SwissRound[] = [play(firstRound([...keys(n)].sort(() => random() - 0.5)), () => random() < 0.5)];
      while (rounds.length < target) {
        const draw = nextRound(keys(n), rounds);
        expect(draw, `trial ${trial} round ${rounds.length + 1}`).not.toBeNull();
        rounds.push(play(draw!, () => random() < 0.5));
      }
    }
  });

  it("returns null once no draw without a rematch is left", () => {
    const random = rng(3);
    const rounds: SwissRound[] = [play(firstRound(keys(6)), () => random() < 0.5)];
    // Six pairs can play a full round robin: five rounds, then nothing.
    for (let r = 1; r < 5; r++) rounds.push(play(nextRound(keys(6), rounds)!, () => random() < 0.5));
    expect(new Set(edges(rounds)).size).toBe(15);
    expect(nextRound(keys(6), rounds)).toBeNull();
  });
});

describe("playoffs", () => {
  it("splits every night into groups of four, a two-game series, or a ladder of three", () => {
    expect([6, 7, 8, 9, 10, 11, 12].map(playoffShape)).toEqual([
      { groups: [1], series: 5, ladder: null },
      { groups: [1], series: null, ladder: 5 },
      { groups: [1, 5], series: null, ladder: null },
      { groups: [1], series: 5, ladder: 7 },
      { groups: [1, 5], series: 9, ladder: null },
      { groups: [1, 5], series: null, ladder: 9 },
      { groups: [1, 5, 9], series: null, ladder: null },
    ]);
  });

  /** Plays a wave with a chooser for the winner. */
  const score = (games: PlayoffGame[], aWins: (g: PlayoffGame) => boolean): PlayedPlayoff[] =>
    games.map((g) => { const w = aWins(g); return { ...g, status: "completed", scoreA: w ? 11 : 6, scoreB: w ? 6 : 11 }; });

  it.each([6, 7, 8, 9, 10, 11, 12])("%i pairs: everyone plays both waves except one ladder pair, and every place is filled", (n) => {
    const ranked = keys(n);
    const w1 = playoffWave1(ranked);
    const inW1 = w1.flatMap((g) => [g.a, g.b]);
    expect(new Set(inW1).size).toBe(inW1.length);
    expect(inW1.length).toBe(n % 2 ? n - 1 : n);
    expect(playoffWave2(ranked, w1.map((g) => ({ ...g, status: "scheduled", scoreA: null, scoreB: null })))).toBeNull();

    for (let trial = 0; trial < 50; trial++) {
      const random = rng(trial * 31 + n);
      const played1 = score(w1, () => random() < 0.5);
      const w2 = playoffWave2(ranked, played1)!;
      const inW2 = w2.flatMap((g) => [g.a, g.b]);
      expect(new Set(inW2).size).toBe(inW2.length);
      expect(inW2.length).toBe(n % 2 ? n - 1 : n);
      const places = finalPlaces(ranked, [...played1, ...score(w2, () => random() < 0.5)])!;
      expect([...places].sort()).toEqual([...ranked].sort());
    }
  });

  it("keeps the Swiss order when every higher seed wins", () => {
    for (const n of [6, 7, 8, 9, 10, 11, 12]) {
      const ranked = keys(n);
      const rank = (k: PairKey) => ranked.indexOf(k);
      const higher = (g: PlayoffGame) => rank(g.a) < rank(g.b);
      const played1 = score(playoffWave1(ranked), higher);
      const played2 = score(playoffWave2(ranked, played1)!, higher);
      expect(finalPlaces(ranked, [...played1, ...played2])).toEqual(ranked);
    }
  });

  it("sends semi-final winners to gold and losers to bronze, and the same in lower groups", () => {
    const ranked = keys(8);
    const played1 = score(playoffWave1(ranked), (g) => g.a !== "p01" && g.a !== "p05"); // upsets in semi 1s
    expect(playoffWave2(ranked, played1)).toEqual([
      { a: "p04", b: "p02", kind: "place", place: 1, leg: 1 },
      { a: "p01", b: "p03", kind: "place", place: 3, leg: 1 },
      { a: "p08", b: "p06", kind: "place", place: 5, leg: 1 },
      { a: "p05", b: "p07", kind: "place", place: 7, leg: 1 },
    ]);
  });

  it("decides a split series on total points, then the higher seed", () => {
    const ranked = keys(6);
    const done = (w1: [number, number], w2: [number, number]): PairKey[] => {
      const p1 = playoffWave1(ranked).map((g): PlayedPlayoff => g.kind === "series"
        ? { ...g, status: "completed", scoreA: w1[0], scoreB: w1[1] }
        : { ...g, status: "completed", scoreA: 11, scoreB: 5 });
      const p2 = playoffWave2(ranked, p1)!.map((g): PlayedPlayoff => g.kind === "series"
        ? { ...g, status: "completed", scoreA: w2[0], scoreB: w2[1] }
        : { ...g, status: "completed", scoreA: 11, scoreB: 5 });
      return finalPlaces(ranked, [...p1, ...p2])!.slice(4);
    };
    expect(done([11, 5], [11, 9])).toEqual(["p05", "p06"]);
    expect(done([5, 11], [9, 11])).toEqual(["p06", "p05"]);
    expect(done([11, 2], [8, 11])).toEqual(["p05", "p06"]); // 1–1, 19 v 13 points
    expect(done([2, 11], [11, 8])).toEqual(["p06", "p05"]); // 1–1, 13 v 19 points
    expect(done([11, 9], [9, 11])).toEqual(["p05", "p06"]); // level: the higher seed
  });

  it("runs a ladder: the two lowest first, the winner then plays the highest of three", () => {
    const ranked = keys(7);
    const w1 = playoffWave1(ranked);
    expect(w1.find((g) => g.kind === "ladder")).toEqual({ a: "p06", b: "p07", kind: "ladder", place: 5, leg: 1 });
    const played1 = score(w1, (g) => g.kind !== "ladder"); // p07 wins the first ladder game
    expect(playoffWave2(ranked, played1)!.find((g) => g.kind === "ladder"))
      .toEqual({ a: "p05", b: "p07", kind: "ladder", place: 5, leg: 2 });
    const played2 = score(playoffWave2(ranked, played1)!, () => true);
    expect(finalPlaces(ranked, [...played1, ...played2])!.slice(4)).toEqual(["p05", "p07", "p06"]);
  });
});

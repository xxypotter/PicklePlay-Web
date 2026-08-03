import { describe, expect, it } from "vitest";
import {
  applyRound,
  emptyHistory,
  generateRound,
  pairKey,
  selectSeated,
  type GenPlayer,
  type Round,
  type SessionHistory,
} from "./generator";

/** Deterministic PRNG so a failure is always reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const makePlayers = (n: number, ratings?: number[]): GenPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    rating: ratings?.[i] ?? 3.0 + i * 0.15,
  }));

/** Run a whole session and hand back every round plus the final history. */
function playSession(
  players: GenPlayer[],
  courts: number,
  rounds: number,
  options: Parameters<typeof generateRound>[3] = {},
): { rounds: Round[]; history: SessionHistory } {
  let history = emptyHistory();
  const out: Round[] = [];
  for (let r = 0; r < rounds; r++) {
    const round = generateRound(players, courts, history, { restarts: 40, ...options });
    out.push(round);
    history = applyRound(history, round);
  }
  return { rounds: out, history };
}

describe("seating and sit-outs", () => {
  it("seats everyone when there's room", () => {
    const { seated, sittingOut } = selectSeated(makePlayers(8), 8, emptyHistory(), seeded(1));
    expect(seated).toHaveLength(8);
    expect(sittingOut).toHaveLength(0);
  });

  it("never sits anyone twice before everyone has sat once", () => {
    // 10 players on 2 courts means 8 play and 2 sit every round.
    const players = makePlayers(10);
    const { history } = playSession(players, 2, 5, { random: seeded(7) });

    const counts = players.map((p) => history.sitOuts[p.id] ?? 0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("keeps games played even across a long session", () => {
    const players = makePlayers(11);
    const { history } = playSession(players, 2, 12, { random: seeded(3) });

    const games = players.map((p) => history.gamesPlayed[p.id] ?? 0);
    expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(1);
  });

  it("drops courts it cannot fill rather than inventing players", () => {
    const round = generateRound(makePlayers(6), 2, emptyHistory(), { random: seeded(1) });
    expect(round.courts).toHaveLength(1);
    expect(round.sittingOut).toHaveLength(2);
  });

  it("returns nobody playing when there aren't four players", () => {
    const round = generateRound(makePlayers(3), 2, emptyHistory(), { random: seeded(1) });
    expect(round.courts).toHaveLength(0);
    expect(round.sittingOut).toHaveLength(3);
  });
});

describe("court structure", () => {
  it("puts every seated player on exactly one court, once", () => {
    const players = makePlayers(12);
    const round = generateRound(players, 3, emptyHistory(), { random: seeded(5) });

    const used = round.courts.flatMap((c) => [...c.teamA, ...c.teamB]);
    expect(used).toHaveLength(12);
    expect(new Set(used).size).toBe(12);
    expect(new Set([...used, ...round.sittingOut]).size).toBe(12);
  });

  it("numbers courts from 1", () => {
    const round = generateRound(makePlayers(12), 3, emptyHistory(), { random: seeded(2) });
    expect(round.courts.map((c) => c.courtNo)).toEqual([1, 2, 3]);
  });
});

describe("balanced format", () => {
  it("makes each court close on paper", () => {
    // A wide spread is the hard case: naive assignment would strand the 4.8
    // and the 2.6 on the same court.
    const players = makePlayers(8, [4.8, 4.5, 4.1, 3.8, 3.4, 3.1, 2.9, 2.6]);
    const round = generateRound(players, 2, emptyHistory(), { random: seeded(11) });
    const rating = new Map(players.map((p) => [p.id, p.rating]));

    for (const court of round.courts) {
      const teamA = court.teamA.reduce((s, id) => s + rating.get(id)!, 0) / 2;
      const teamB = court.teamB.reduce((s, id) => s + rating.get(id)!, 0) / 2;
      expect(Math.abs(teamA - teamB)).toBeLessThan(0.35);
    }
  });

  it("spreads partners around rather than reusing the same pair", () => {
    const players = makePlayers(12);
    const { history } = playSession(players, 3, 6, { random: seeded(13) });

    const repeats = Object.values(history.partnerCounts);
    // 6 rounds x 3 courts = 36 partnerships from 66 possible pairs; nobody
    // should be stuck with the same partner more than twice.
    expect(Math.max(...repeats)).toBeLessThanOrEqual(2);
  });

  it("avoids stranding a beginner with an expert on the same court", () => {
    const players = makePlayers(8, [4.8, 4.6, 4.4, 4.2, 3.0, 2.9, 2.8, 2.6]);
    const round = generateRound(players, 2, emptyHistory(), { random: seeded(17) });
    const rating = new Map(players.map((p) => [p.id, p.rating]));

    for (const court of round.courts) {
      const all = [...court.teamA, ...court.teamB].map((id) => rating.get(id)!);
      expect(Math.max(...all) - Math.min(...all)).toBeLessThan(1.5);
    }
  });
});

describe("other formats", () => {
  it("fixed keeps partnerships together across rounds", () => {
    const { history } = playSession(makePlayers(8), 2, 4, {
      format: "fixed",
      random: seeded(19),
    });

    // Four rounds with fixed pairs means each of the 4 pairs recurs every round.
    const repeats = Object.values(history.partnerCounts).sort((a, b) => b - a);
    expect(repeats.slice(0, 4).every((n) => n === 4)).toBe(true);
  });

  it("social ignores rating balance", () => {
    const social = makePlayers(8, [4.8, 4.6, 4.4, 4.2, 3.0, 2.9, 2.8, 2.6]);
    const rating = new Map(social.map((p) => [p.id, p.rating]));

    let sawLopsided = false;
    for (let seed = 1; seed <= 12; seed++) {
      const round = generateRound(social, 2, emptyHistory(), {
        format: "social",
        random: seeded(seed),
      });
      for (const court of round.courts) {
        const a = court.teamA.reduce((s, id) => s + rating.get(id)!, 0) / 2;
        const b = court.teamB.reduce((s, id) => s + rating.get(id)!, 0) / 2;
        if (Math.abs(a - b) > 0.5) sawLopsided = true;
      }
    }
    expect(sawLopsided).toBe(true);
  });

  it("tiered puts the strongest four on court 1", () => {
    const players = makePlayers(12);
    const round = generateRound(players, 3, emptyHistory(), {
      tiered: true,
      random: seeded(23),
    });
    const rating = new Map(players.map((p) => [p.id, p.rating]));

    const avg = round.courts.map(
      (c) => [...c.teamA, ...c.teamB].reduce((s, id) => s + rating.get(id)!, 0) / 4,
    );
    expect(avg[0]).toBeGreaterThan(avg[1]);
    expect(avg[1]).toBeGreaterThan(avg[2]);
  });
});

describe("history bookkeeping", () => {
  it("records partners, opponents, games, and sit-outs", () => {
    const round: Round = {
      courts: [{ courtNo: 1, teamA: ["p1", "p2"], teamB: ["p3", "p4"] }],
      sittingOut: ["p5"],
    };
    const h = applyRound(emptyHistory(), round);

    expect(h.partnerCounts[pairKey("p1", "p2")]).toBe(1);
    expect(h.partnerCounts[pairKey("p3", "p4")]).toBe(1);
    expect(h.opponentCounts[pairKey("p1", "p3")]).toBe(1);
    expect(h.opponentCounts[pairKey("p2", "p4")]).toBe(1);
    expect(h.partnerCounts[pairKey("p1", "p3")]).toBeUndefined();
    expect(h.gamesPlayed).toEqual({ p1: 1, p2: 1, p3: 1, p4: 1 });
    expect(h.sitOuts).toEqual({ p5: 1 });
  });

  it("treats pair keys as unordered", () => {
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });

  it("does not mutate the history it was given", () => {
    const before = emptyHistory();
    applyRound(before, {
      courts: [{ courtNo: 1, teamA: ["p1", "p2"], teamB: ["p3", "p4"] }],
      sittingOut: [],
    });
    expect(before.gamesPlayed).toEqual({});
  });
});

describe("determinism", () => {
  it("gives the same round for the same seed", () => {
    const players = makePlayers(12);
    const a = generateRound(players, 3, emptyHistory(), { random: seeded(99) });
    const b = generateRound(players, 3, emptyHistory(), { random: seeded(99) });
    expect(a).toEqual(b);
  });
});

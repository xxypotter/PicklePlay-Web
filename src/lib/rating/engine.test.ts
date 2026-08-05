/**
 * The rating engine is the part of this product that has to be *right*, so the
 * spec's worked examples (SPEC.md §5.5) are asserted here literally. If someone
 * retunes a constant in constants.ts, these tests say exactly which documented
 * DUPR behavior they broke.
 */
import { describe, expect, it } from "vitest";
import { RATING } from "./constants";
import {
  compression,
  evidenceWeight,
  expectedShare,
  kFactor,
  matchSurprise,
  ratingDelta,
  recompute,

  type MatchEvent,
  type SeedEvent,
  type TimelineEvent,
} from "./engine";

/** An established player: reliability 1, well past the calibration window. */
const K_ESTABLISHED = RATING.K_RELIABLE;
/** Mid-scale rating, far enough from both bounds that compression is inert. */
const MID = 3.5;

const delta = (surprise: number, rating = MID) =>
  ratingDelta(rating, K_ESTABLISHED, surprise, false);

describe("expectation curves (§5.3 step 1)", () => {
  it("is a coin flip between equal teams", () => {
    expect(expectedShare(4, 4, RATING.D_POINTS)).toBeCloseTo(0.5, 10);
    expect(expectedShare(4, 4, RATING.D_WIN)).toBeCloseTo(0.5, 10);
  });

  it("calibrates a 1.00 gap to ~11-3 on points and ~90% on wins", () => {
    expect(expectedShare(4.5, 3.5, RATING.D_POINTS)).toBeCloseTo(0.788, 3);
    expect(expectedShare(4.5, 3.5, RATING.D_WIN)).toBeCloseTo(0.909, 3);
  });

  it("keeps the win curve steeper than the points curve at every gap", () => {
    for (const gap of [0.1, 0.25, 0.5, 1, 2]) {
      const points = expectedShare(4 + gap, 4, RATING.D_POINTS);
      const wins = expectedShare(4 + gap, 4, RATING.D_WIN);
      expect(wins).toBeGreaterThan(points);
    }
  });
});

describe("worked examples (§5.5)", () => {
  it("even teams, win 11-9 → +0.021", () => {
    const s = matchSurprise(MID, MID, 11, 9);
    expect(s).toBeCloseTo(0.3425, 4);
    expect(delta(s)).toBeCloseTo(0.021, 3);
  });

  it("even teams, win 11-0 → +0.030", () => {
    const s = matchSurprise(MID, MID, 11, 0);
    expect(s).toBeCloseTo(0.5, 4);
    expect(delta(s)).toBeCloseTo(0.03, 3);
  });

  it("underdog by 1.00, wins 11-9 → +0.043", () => {
    const s = matchSurprise(3.5, 4.5, 11, 9);
    expect(s).toBeCloseTo(0.7094, 4);
    expect(delta(s)).toBeCloseTo(0.043, 3);
  });

  it("favorite by 1.00, wins 11-2 → +0.005", () => {
    const s = matchSurprise(4.5, 3.5, 11, 2);
    expect(s).toBeCloseTo(0.0793, 4);
    expect(delta(s, 4.5)).toBeCloseTo(0.005, 3);
  });

  it("favorite by 1.00, wins 11-9 → -0.001 (down in a win)", () => {
    const s = matchSurprise(4.5, 3.5, 11, 9);
    expect(s).toBeLessThan(0);
    expect(delta(s, 4.5)).toBeCloseTo(-0.001, 3);
  });

  it("underdog by 1.00, loses 9-11 → +0.001 (up in a loss)", () => {
    const s = matchSurprise(3.5, 4.5, 9, 11);
    expect(s).toBeGreaterThan(0);
    expect(delta(s)).toBeCloseTo(0.001, 3);
  });
});

describe("documented DUPR behaviors (§5.1)", () => {
  it("#1 rewards beating a stronger opponent far more than a weaker one", () => {
    const upset = matchSurprise(3.5, 4.5, 11, 9);
    const expected = matchSurprise(4.5, 3.5, 11, 9);
    expect(upset).toBeGreaterThan(Math.abs(expected) * 10);
  });

  it("#4 lets margin matter, but only a little", () => {
    const blowout = delta(matchSurprise(MID, MID, 11, 0));
    const squeaker = delta(matchSurprise(MID, MID, 11, 9));
    const marginEffect = blowout - squeaker;
    expect(marginEffect).toBeGreaterThan(0);
    // Margin is worth well under half of what winning at all is worth.
    expect(marginEffect).toBeLessThan(squeaker * 0.5);
  });

  it("#5 moves a brand-new player far faster than an established one", () => {
    const s = matchSurprise(MID, MID, 11, 9);
    const rookie = ratingDelta(MID, kFactor(0, 0), s, true);
    const veteran = ratingDelta(MID, kFactor(1, 50), s, false);
    expect(rookie).toBeGreaterThan(veteran * 5);
  });

  it("#6 compresses movement near the ceiling and the floor", () => {
    expect(compression(MID, true)).toBe(1);
    expect(compression(7.5, true)).toBeLessThan(1);
    expect(compression(2.5, false)).toBeLessThan(1);
    // Gaining near the floor is unimpeded; only the approached bound compresses.
    expect(compression(2.5, true)).toBe(1);
  });

  it("#7 halves the weight of a result every 90 days", () => {
    expect(3 * evidenceWeight(0)).toBeCloseTo(3, 10);
    expect(6 * evidenceWeight(90)).toBeCloseTo(3, 10);
    expect(12 * evidenceWeight(180)).toBeCloseTo(3, 10);
  });

  it("#8 moves both partners the same direction by different amounts", () => {
    const now = Date.now();
    // p1 has a real match history here; the rookie has nothing but a seed.
    const events = roundRobin(now);
    events.push(seed("rookie", 3.8, 0, now - day(1)));
    events.push(match("final", ["p1", "rookie"], ["p3", "p4"], 11, 9, now));

    const { changes } = recompute(events);
    const vet = changes.find((c) => c.matchId === "final" && c.playerId === "p1")!;
    const rook = changes.find((c) => c.matchId === "final" && c.playerId === "rookie")!;

    expect(Math.sign(vet.delta)).toBe(Math.sign(rook.delta));
    expect(Math.abs(rook.delta)).toBeGreaterThan(Math.abs(vet.delta));
  });
});

describe("K factor and the seed floor (§5.3, §5.7)", () => {
  it("falls monotonically as reliability rises", () => {
    const ks = [0, 0.25, 0.5, 0.75, 1].map((r) => kFactor(r, 50));
    for (let i = 1; i < ks.length; i++) expect(ks[i]).toBeLessThan(ks[i - 1]);
  });

  it("bottoms out at K_RELIABLE for a fully established player", () => {
    expect(kFactor(1, 50)).toBeCloseTo(RATING.K_RELIABLE, 10);
  });

  it("floors K until the player has 5 local matches, however reliable they claim to be", () => {
    expect(kFactor(1, 0)).toBeGreaterThanOrEqual(RATING.K_SEED_FLOOR);
    expect(kFactor(1, 4)).toBeGreaterThanOrEqual(RATING.K_SEED_FLOOR);
    expect(kFactor(1, 5)).toBeLessThan(RATING.K_SEED_FLOOR);
  });

});

describe("whole-history recompute (§5.6)", () => {
  const now = Date.now();

  it("is deterministic", () => {
    const events = roundRobin(now);
    const a = recompute(events);
    const b = recompute(events);
    for (const [id, p] of a.players) {
      expect(p.rating).toBeCloseTo(b.players.get(id)!.rating, 12);
    }
  });

  it("does not depend on the order events are supplied in", () => {
    const events = roundRobin(now);
    const shuffled = [...events].reverse();
    const a = recompute(events);
    const b = recompute(shuffled);
    for (const [id, p] of a.players) {
      expect(p.rating).toBeCloseTo(b.players.get(id)!.rating, 12);
    }
  });

  it("keeps every rating inside the scale", () => {
    // 60 straight blowout wins for one pair is the most extreme pressure the
    // scale will ever see; it must not escape the bounds.
    const events: TimelineEvent[] = [
      seed("a", 7.9, 100, now - day(500)),
      seed("b", 7.9, 100, now - day(500)),
      seed("c", 2.1, 100, now - day(500)),
      seed("d", 2.1, 100, now - day(500)),
    ];
    for (let i = 0; i < 60; i++) {
      events.push(match(`m${i}`, ["a", "b"], ["c", "d"], 11, 0, now - day(60 - i)));
    }
    for (const p of recompute(events).players.values()) {
      expect(p.rating).toBeGreaterThanOrEqual(RATING.MIN);
      expect(p.rating).toBeLessThanOrEqual(RATING.MAX);
    }
  });

  it("is zero-sum between evenly matched sides", () => {
    // Four players in identical states move by equal and opposite amounts, so
    // no rating is created or destroyed by playing a match.
    const events: TimelineEvent[] = [
      seed("a", 4, 60, now - day(2)),
      seed("b", 4, 60, now - day(2)),
      seed("c", 4, 60, now - day(2)),
      seed("d", 4, 60, now - day(2)),
      match("m1", ["a", "b"], ["c", "d"], 11, 6, now),
    ];
    const total = recompute(events).changes.reduce((sum, c) => sum + c.delta, 0);
    expect(total).toBeCloseTo(0, 10);
  });

  it("applies a re-seed as a dated event in history, not an overwrite (§5.8)", () => {
    const base: TimelineEvent[] = [
      seed("x", 3.0, 50, now - day(200)),
      seed("y", 4.5, 100, now - day(200)),
      seed("z", 4.5, 100, now - day(200)),
      seed("w", 4.5, 100, now - day(200)),
    ];
    for (let i = 0; i < 12; i++) {
      base.push(match(`m${i}`, ["x", "y"], ["z", "w"], 11, 3, now - day(150 - i * 10)));
    }

    const withReseed: TimelineEvent[] = [
      ...base,
      { ...seed("x", 3.2, 80, now - day(5)), isInitial: false },
    ];

    const after = recompute(withReseed).players.get("x")!;
    // The re-seed lands 5 days before the end with no matches after it, so the
    // declared value must survive intact.
    expect(after.rating).toBeCloseTo(3.2, 10);
  });

  it("tracks W/L, points, and streak", () => {
    const events: TimelineEvent[] = [
      seed("a", 4, 0, now - day(30)),
      seed("b", 4, 0, now - day(30)),
      seed("c", 4, 0, now - day(30)),
      seed("d", 4, 0, now - day(30)),
      match("m1", ["a", "b"], ["c", "d"], 11, 5, now - day(3)),
      match("m2", ["a", "b"], ["c", "d"], 11, 7, now - day(2)),
      match("m3", ["a", "b"], ["c", "d"], 4, 11, now - day(1)),
    ];
    const a = recompute(events).players.get("a")!;
    expect(a.wins).toBe(2);
    expect(a.losses).toBe(1);
    expect(a.localMatches).toBe(3);
    expect(a.pointsFor).toBe(26);
    expect(a.pointsAgainst).toBe(23);
    expect(a.streak).toBe(-1);
  });

  it("marks a thin record provisional and self-declared", () => {
    const events: TimelineEvent[] = [
      seed("a", 3.5, 0, now - day(10)),
      seed("b", 3.5, 0, now - day(10)),
      seed("c", 3.5, 0, now - day(10)),
      seed("d", 3.5, 0, now - day(10)),
      match("m1", ["a", "b"], ["c", "d"], 11, 9, now - day(1)),
    ];
    const a = recompute(events).players.get("a")!;
    expect(a.provisional).toBe(true);
    expect(a.selfDeclared).toBe(true);
    expect(a.localMatches).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const day = (n: number) => n * 86_400_000;

function seed(
  playerId: string,
  rating: number,
  declaredReliability: number,
  atMs: number,
  opts: { isInitial?: boolean; selfInitiated?: boolean } = {},
): SeedEvent {
  return {
    kind: "seed",
    at: new Date(atMs),
    playerId,
    rating,
    declaredReliability,
    isInitial: opts.isInitial ?? true,
    selfInitiated: opts.selfInitiated ?? true,
  };
}

function match(
  matchId: string,
  teamA: [string, string],
  teamB: [string, string],
  scoreA: number,
  scoreB: number,
  atMs: number,
): MatchEvent {
  return { kind: "match", at: new Date(atMs), matchId, teamA, teamB, scoreA, scoreB };
}

/** Eight players, every result a different scoreline — a realistic club night. */
function roundRobin(now: number): TimelineEvent[] {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const events: TimelineEvent[] = ids.map((id, i) =>
    seed(id, 3.0 + i * 0.2, (i % 5) * 25, now - day(120)),
  );
  let n = 0;
  for (let round = 0; round < 10; round++) {
    for (let court = 0; court < 2; court++) {
      const o = (round + court * 4) % 8;
      const pick = (k: number) => ids[(o + k) % 8];
      events.push(
        match(
          `m${n}`,
          [pick(0), pick(1)],
          [pick(2), pick(3)],
          11,
          (n * 3) % 11,
          now - day(100 - round * 8),
        ),
      );
      n++;
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Reliability (§5.4) — DUPR's doubles waypoints: 2 partners + 6 opposing teams
// reaches 60%, 4 + 12 reaches 100%.
// ---------------------------------------------------------------------------

/**
 * One night for p0: eight games, a different partner each time and a different
 * opposing pair each time. What a 9-player round robin actually produces.
 */
function session(atMs: number, tag: string, gap = 2): MatchEvent[] {
  const out: MatchEvent[] = [];
  const others = [1, 2, 3, 4, 5, 6, 7, 8];
  for (let k = 0; k < 8; k++) {
    // Rotating offsets, so all eight partners and all eight opposing pairs are
    // distinct. Picking opponents ad hoc quietly repeats pairs, which lands the
    // count on the 6-team boundary and makes the test depend on decay.
    const partner = others[k];
    const o1 = others[(k + 1) % 8];
    const o2 = others[(k + gap) % 8];
    out.push(
      match(`${tag}${k}`, ["p0", `p${partner}`], [`p${o1}`, `p${o2}`], 11, k % 2 ? 7 : 9,
        atMs + k * 600_000),
    );
  }
  return out;
}

/** Nine players seeded at the same rating, with whatever reliability we choose. */
const cast = (declared: number, atMs: number) =>
  Array.from({ length: 9 }, (_, i) => seed(`p${i}`, 3.5, declared, atMs));

describe("a trusted signup declaration (§5.7)", () => {
  const now = Date.now();

  it("takes a declared reliability at face value", () => {
    // Deliberate: a small group where everyone knows everyone, so a copied
    // DUPR reliability beats making an established player prove themselves.
    const p = recompute([seed("p1", 4.3, 85, now - day(1))]).players.get("p1")!;
    expect(p.reliability).toBeCloseTo(0.85, 6);
    expect(p.provisional).toBe(false);
  });

  it("leaves someone who declares nothing unproven rather than penalised", () => {
    const p = recompute([seed("p1", 4.3, 0, now - day(1))]).players.get("p1")!;
    expect(p.reliability).toBe(0);
    expect(p.provisional).toBe(true);
  });

  it("still anchors where the player starts", () => {
    const high = recompute([seed("p1", 5.0, 0, now - day(1))]).players.get("p1")!;
    const low = recompute([seed("p2", 2.5, 0, now - day(1))]).players.get("p2")!;
    expect(high.rating).toBeGreaterThan(low.rating);
  });

  it("keeps a fast K for the first few matches even when fully trusted", () => {
    // Trust decides the badge, not how quickly a wrong number can correct.
    expect(kFactor(1, 0)).toBeGreaterThanOrEqual(RATING.K_SEED_FLOOR);
  });
});

describe("reliability is earned from variety, not volume (§5.4)", () => {
  const now = Date.now();

  it("gains nothing from replaying the same two people", () => {
    // Ten games, one partner, one opposing pair. DUPR counts distinct
    // partners and distinct opposing teams, so this is worth one of each.
    const events: TimelineEvent[] = [
      ...cast(0, now - day(60)).slice(0, 4),
      ...Array.from({ length: 10 }, (_, k) =>
        match(`r${k}`, ["p0", "p1"], ["p2", "p3"], 11, 7, now - day(30) + k * 600_000),
      ),
    ];
    const p = recompute(events).players.get("p0")!;
    expect(p.localMatches).toBe(10);
    expect(p.provisional).toBe(true);
    // 1 partner and 1 team, both unknown: well short of 2 and 6.
    expect(p.reliability).toBeLessThan(0.3);
  });

  it("settles a newcomer in one night among established players", () => {
    // The case that actually matters: friends who already carry a real DUPR
    // reliability, and someone new joining them.
    const events: TimelineEvent[] = [
      seed("p0", 3.5, 0, now - day(60)),
      ...Array.from({ length: 8 }, (_, i) => seed(`p${i + 1}`, 3.5, 100, now - day(60))),
      ...session(now - day(1), "a"),
    ];
    const p = recompute(events).players.get("p0")!;
    expect(p.provisional).toBe(false);
    expect(p.reliability).toBeGreaterThanOrEqual(RATING.RELIABILITY_PASS);
  });

  it("takes a second night when nobody in the group is established", () => {
    // Everyone at zero: each partner is worth half, so one night lands short.
    const one = recompute([...cast(0, now - day(60)), ...session(now - day(8), "a")]);
    const after1 = one.players.get("p0")!;
    expect(after1.provisional).toBe(true);

    const two = recompute([
      ...cast(0, now - day(60)),
      ...session(now - day(8), "a"),
      ...session(now - day(1), "b", 3),
    ]);
    const after2 = two.players.get("p0")!;
    expect(after2.reliability).toBeGreaterThan(after1.reliability);
    expect(after2.provisional).toBe(false);
  });

  it("bootstraps from an all-unknown group rather than deadlocking", () => {
    // Taken literally, "weight by opponent reliability" never starts when
    // everyone is zero. The floor is what stops that.
    const r = recompute([...cast(0, now - day(60)), ...session(now - day(1), "a")])
      .players.get("p0")!.reliability;
    expect(r).toBeGreaterThan(0);
  });

  it("fades when you stop playing and the group carries on", () => {
    /*
     * Decay is measured against the last event in the timeline, so an inactive
     * player only fades relative to a group that keeps going — the behaviour
     * DUPR describes, and what makes a stale number honest.
     *
     * Nobody declares here on purpose. A declared reliability is a floor that
     * does not decay: taking the claim at face value means still taking it at
     * face value a year later. Only reliability *earned* by playing fades.
     */
    const events: TimelineEvent[] = [
      ...cast(0, now - day(400)),
      ...session(now - day(370), "a"),
      ...session(now - day(365), "b", 3),
      // A year of matches p0 is not part of.
      ...Array.from({ length: 12 }, (_, k) =>
        match(`late${k}`, ["p1", "p2"], ["p3", "p4"], 11, 7, now - day(60) + k * day(4)),
      ),
    ];
    const p0 = recompute(events).players.get("p0")!;
    expect(p0.provisional).toBe(true);
  });

  it("counts an established partner for more than an unknown one", () => {
    const known = recompute([
      seed("p0", 3.5, 0, now - day(60)),
      ...Array.from({ length: 8 }, (_, i) => seed(`p${i + 1}`, 3.5, 100, now - day(60))),
      ...session(now - day(1), "a"),
    ]).players.get("p0")!.reliability;

    const unknown = recompute([...cast(0, now - day(60)), ...session(now - day(1), "a")])
      .players.get("p0")!.reliability;

    expect(known).toBeGreaterThan(unknown);
  });
});

describe("changing your own rating reopens the question (§5.8)", () => {
  const now = Date.now();

  const established = (): TimelineEvent[] => [
    seed("p0", 3.5, 0, now - day(60)),
    ...Array.from({ length: 8 }, (_, i) => seed(`p${i + 1}`, 3.5, 100, now - day(60))),
    ...session(now - day(10), "a"),
  ];

  it("sends a self re-seed back to provisional", () => {
    const before = recompute(established()).players.get("p0")!;
    expect(before.provisional).toBe(false);

    const after = recompute([
      ...established(),
      seed("p0", 4.6, 0, now - day(1), { isInitial: false, selfInitiated: true }),
    ]).players.get("p0")!;

    expect(after.rating).toBeCloseTo(4.6, 6);
    expect(after.provisional).toBe(true);
    expect(after.reliability).toBe(0);
  });

  it("leaves the match record alone when it does", () => {
    // Those games really happened; only the evidence for *this figure* resets.
    const after = recompute([
      ...established(),
      seed("p0", 4.6, 0, now - day(1), { isInitial: false, selfInitiated: true }),
    ]).players.get("p0")!;
    expect(after.localMatches).toBe(8);
    expect(after.wins + after.losses).toBe(8);
  });

  it("does not punish an admin correction the same way", () => {
    // Someone else vouched for this number, so it isn't self-serving.
    const after = recompute([
      ...established(),
      seed("p0", 4.6, 0, now - day(1), { isInitial: false, selfInitiated: false }),
    ]).players.get("p0")!;
    expect(after.rating).toBeCloseTo(4.6, 6);
    expect(after.provisional).toBe(false);
  });

  it("treats an owner adjusting their own rating as an admin correction", () => {
    /*
     * The super admin has both roles, so `createdBy === playerId` is true for
     * an admin-panel adjustment he makes on himself. Reading that as a
     * self-override wiped his reliability. The door it came through is what
     * counts, and only `source` records that.
     */
    const after = recompute([
      ...established(),
      seed("p0", 4.6, 55, now - day(1), { isInitial: false, selfInitiated: false }),
    ]).players.get("p0")!;
    expect(after.provisional).toBe(false);
    expect(after.reliability).toBeGreaterThan(0);
  });

  it("lets a re-seeded player earn it back by playing again", () => {
    const after = recompute([
      ...established(),
      seed("p0", 4.6, 0, now - day(5), { isInitial: false, selfInitiated: true }),
      ...session(now - day(1), "b", 3),
    ]).players.get("p0")!;
    expect(after.provisional).toBe(false);
  });
});

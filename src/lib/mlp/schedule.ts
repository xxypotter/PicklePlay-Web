import { GAME_KINDS, robinBlocks, validMlpConfig, type GameKind } from "./rules";

export interface PlannedEncounter {
  teams: readonly [number, number];
  /** One-based display block; waves are zero-based across the whole plan. */
  block: number;
  games: Array<{ kind: GameKind; wave: number; court: number }>;
}

/** The original two-court/two-wave layout, also used for every playoff stage. */
export function twoCourtSchedule(blocks: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): PlannedEncounter[] {
  return blocks.flatMap((block, bi) => block.map((teams, ci) => ({
    teams, block: bi + 1,
    games: GAME_KINDS.map((kind, gi) => ({kind, wave: bi * 2 + Math.floor(gi / 2), court: ci * 2 + gi % 2 + 1})),
  })));
}

/**
 * Six teams / five courts: partition K6 into three five-encounter blocks.
 * In each block a different pair of teams plays its four games sequentially
 * on court 5. The other four teams play two opponents on courts 1–4, taking
 * two waves per encounter. Across three blocks every edge appears once.
 * Each team gets exactly one single-court encounter, hence every player has
 * ten games and two rest waves. All 60 games fit in 12 full five-court waves.
 * Opening games finish before mixed games even in the single-court encounter;
 * no player or team meets two opponents in the same wave. Pair choices never
 * enter the scheduling algorithm, so any valid organizer lineups work.
 */
function fiveCourtSchedule(): PlannedEncounter[] {
  const plan: PlannedEncounter[] = [];
  const groups = [
    {single: [0,1], others: [2,3,4,5]},
    {single: [2,3], others: [0,1,4,5]},
    {single: [4,5], others: [0,1,2,3]},
  ];
  for (const [bi, {single, others: [a,b,c,d]}] of groups.entries()) {
    const base = bi * 4;
    const parallel = twoCourtSchedule([[[a,c],[b,d]], [[a,d],[b,c]]]);
    plan.push(...parallel.map(tie => ({...tie, block: bi + 1,
      games: tie.games.map(g => ({...g, wave: base + g.wave})),
    })));
    plan.push({teams: [single[0], single[1]], block: bi + 1,
      games: GAME_KINDS.map((kind, gi) => ({kind, wave: base + gi, court: 5})),
    });
  }
  return plan;
}

export function roundRobinSchedule(teamCount: number, courtCount: number): PlannedEncounter[] {
  if (!validMlpConfig(courtCount, teamCount * 4)) throw new RangeError("Mini MLP requires 4–6 teams and 4–6 courts");
  // Four/five teams have at most two disjoint encounters. Keep their bye order
  // and reserve extra courts; never split one team across different opponents.
  if (teamCount < 6 || courtCount === 4) return twoCourtSchedule(robinBlocks(teamCount));
  if (courtCount === 5) return fiveCourtSchedule();
  // Circle-method complete round robin: all six teams play in all five blocks.
  return twoCourtSchedule([
    [[0,5],[1,4],[2,3]], [[0,4],[5,3],[1,2]], [[0,3],[4,2],[5,1]],
    [[0,2],[3,1],[4,5]], [[0,1],[2,5],[3,4]],
  ]);
}

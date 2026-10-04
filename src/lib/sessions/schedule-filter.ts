import type { CurrentRound } from "./queries";

/** Intersect player selection with unscored games, keeping original round order. */
export function filterSchedule(rounds: CurrentRound[], picked: string[], hideScored: boolean): CurrentRound[] {
  if (!picked.length && !hideScored) return rounds;
  return rounds.map(round=>({...round,matches:round.matches.filter(m=>
    (!hideScored || (!m.completed && !m.voided)) &&
    picked.every(id=>[...m.teamA,...m.teamB].some(p=>p.id===id)),
  )})).filter(round=>round.matches.length>0);
}

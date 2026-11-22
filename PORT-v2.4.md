# PicklePlay v2.4 — independent iOS app handoff

Read PORT.md §4.1 and §4.4 (updated in place). One matchmaking change; no data,
rating or permission changes.

- The regular round robin now applies the gender-balanced matchup rule: never
  two men (both stated male) against two women (both stated female); anyone
  with an unspecified gender makes their team neutral.
- Whole-session draw: pass a gender per seat to the partner-unique planner,
  but no ratings (the format stays rating-blind). Keep the plan even when the
  rule can't reach zero — that only happens when exactly two women must
  partner once in a full rotation — so "partner everyone once" still holds.
  Gender-balanced instead discards such a plan and draws round by round.
- Adding a round, rebuilding, and shapes with no perfect plan: the per-round
  generator treats MM v FF as forbidden for the regular format, as it already
  did for gender-balanced. A violation-free seating always exists.
- Format descriptions updated in three languages; release note v2.4.

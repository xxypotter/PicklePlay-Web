# PicklePlay v1.7 — native-app update handoff

Read PORT.md first, especially §16. It now covers the full release through
v1.7 (2026-09-26), including the v1.4 roster-rebuild and medal features and the
v1.5/v1.6 work that followed them. This file is the implementation checklist.
The iOS app has independent users, database and rating history.

## Scope to compare with the native app

- v1.4: late arrivals, raise capacity, keep settled rounds, rebuild unplayed
  matchups; fixed-team automatic semifinals, gold and bronze finals.
- v1.5: random/custom added rounds in ordinary formats; custom medal draws;
  fixed-pair standings and bracket; correct complete fixed-team round robin.
- v1.6: expectation-based record insights, D_POINTS=2.05 for future ratings,
  explicit starting-level selection, copying finished sessions to a new date.
- v1.7: Mini MLP plus six audited reliability/permission/documentation fixes.

## Mini MLP acceptance criteria

1. Choose 4, 5 or 6 squads of four players on four named courts. Store the
   selected count via capacity (16, 20, 24). Creation and pre-start editing
   offer the count; reject other capacities/court counts server-side.
2. Permit ANY gender combination: all men, all women, 3+1, 1+3, 2+2 and unknown
   gender. No gender filtering in setup and no gender validation on the server.
3. Each squad chooses two fixed pairs, each with Player 1 and Player 2. Opening
   games pair the two Player 1s and the two Player 2s; second-wave games use the
   fixed pairs. All four team members play twice per encounter, on two courts.
4. Preserve storage compatibility: m1+w1 and m2+w2 are fixed pairs; UI Player 1
   maps to w and Player 2 maps to m. Game identifiers stay women/men/mixed1/mixed2,
   displayed neutrally as Doubles 1, Doubles 2, Fixed pair 1, Fixed pair 2.
   Keep existing matches and teams intact; this update needs no migration.
5. Full round robin: 4 teams → 6 encounters/24 games/6 waves; 5 → 10/40/10;
   6 → 15/60/16. Every player gets 6, 8 or 10 RR games respectively. Five teams
   get one bye each. See PORT §16 and robinBlocks() for verified schedules.
6. After all four valid scores: more games won wins; 2–2 uses total points;
   equal points requires an explicit organizer-recorded winner. No DreamBreaker.
7. Standings use round robin only: squad wins, game difference, point difference,
   points scored, setup slot. Top four seed 1v4 and 2v3. With four squads all
   qualify. Winners play a four-game final; no bronze. Total games: 36/52/72.
8. Create playoffs only after EVERY distinct RR opponent pairing is resolved,
   then the final only after both semifinals resolve. Membership and all lineups
   lock at generation; no edits during play, even before scores are entered.
9. Personal records/ratings apply per game; never rate the aggregate result a
   second time. Casual mode stays unrated. No rating tuning in this update.
10. Protect bracket dependencies: remove only the last completely unplayed
    playoff stage before an upstream correction; never discard scored stages.
11. Test real workflows for all three counts, all gender compositions, preserved
    partner assignments, byes, cap/duplicate/outsider validation, top-four seeding,
    tie resolution and old six-team schedule compatibility.

## Six fixes to carry over

- Fixed partners must be structural in added/rebuilt draws, not a weighted
  preference. Late-arrival pair changes affect future generated games only.
- Verify the round belongs to the authorized session before deletion. Protect
  voids from ordinary score saves. Private link metadata/images must be generic.
- Back up round indices/stages, pair assignments, team encounters and profile
  gender/avatar/locale/imported statistics, not just raw match scores.
- Publish rating caches in one transaction, with recomputes serialized before
  history is read. Failures roll back both caches; users never see a half-rebuild.
- Gender priority is hard: MM-versus-FF cannot become affordable in a long
  history. Sacrifice complete partner coverage when constraints conflict.
- Keep shared project, task and native-port documentation current.

## Reference files and tests

Pure Mini MLP rules: `src/lib/mlp/rules.ts`; workflow: `actions.ts` and `guards.ts`.
UI: `src/components/mlp/`. Pair scheduling: `src/lib/matchmaking/fixed.ts`.
Rating publication: `src/lib/rating/service.ts`, transaction support in `db/`.
Migration: `drizzle/0014_groovy_rachel_grey.sql` (additive, no old match edits).

`rules.test.ts` proves coverage, no double bookings, pair stability, scoring
hierarchy and exact-tie handling. `workflow.integration.test.ts` runs the real
server actions against guarded development storage through all 72 games, fixed
rebuilds, permissions, backups, concurrent rating replays and rollback.

Do not copy our dated historical epochs blindly. Preserve the native app's own
past results; introduce any adopted tuning change at its own release boundary.

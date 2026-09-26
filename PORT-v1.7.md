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

1. Exactly 24 players, 6 named squads of 2 men and 2 women, 4 named courts.
2. Team setup chooses two fixed mixed pairs. Store m1+w1 and m2+w2; never offer
   a change during play. The user's later answer superseded an earlier proposal
   to allow per-encounter changes. Server enforcement matters as much as the UI.
3. Generate all 15 distinct squad encounters. Each is women, men, mixed1,
   mixed2: 60 ordinary doubles games. Every player gets 10 round-robin games.
4. Each encounter uses two courts: women/men in wave one, mixed1/mixed2 in wave
   two. Two disjoint encounters can share four courts. Eight encounter blocks
   occupy 16 waves; never put a player on two courts in the same wave.
5. After all four valid scores: more games won wins; 2–2 uses total points;
   equal points requires an explicit organizer-recorded winner. No DreamBreaker.
6. Standings use round robin only: squad wins, game difference, point difference,
   points scored, setup slot. Display this ordering to users. Top four seed
   semifinals 1v4 and 2v3. Winners play a four-game final; no bronze stage.
7. Create the next stage only when the preceding one is fully resolved. Final
   tournament: 18 encounters / 72 games / 20 court waves. Finalists play 14 games.
8. Existing match records and individual rating changes still apply per game.
   Never rate the aggregate team result again. Casual mode remains unrated.
9. Protect bracket dependencies: block changing a source result used by a later
   stage. Offer removal of the last completely unplayed playoff stage, then
   allow correction and regeneration. Scored/voided stages cannot be discarded.
10. Display squads with their two mixed pairs, aggregate results, semifinal-to-
    final bracket and championship winner. Individual score entry retains the
    existing game cards, labeled women/men/mixed1/mixed2.

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

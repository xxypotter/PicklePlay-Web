# PicklePlay v1.7 — native-app update handoff

Read PORT.md first, especially §16. It now covers the full release through
v1.7 (updated 2026-09-27), including the v1.4 roster-rebuild and medal features and the
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
   Setup shows each name with its profile gender (F/M; none when unspecified)
   purely as information for the organizer.
3. Explicitly choose FOUR fixed category lineups: women's doubles, men's
   doubles, mixed 1, mixed 2. Never infer opening partners from mixed-selector
   positions. Each wave uses all four squad members exactly once; each player
   plays twice per encounter. Category labels impose no gender restriction.
4. Mixed pairs remain m1+w1 and m2+w2. Migration 0015 adds nullable women1,
   women2, men1, men2 references. Require all four for new setups. Old null
   rows preserve their opening w1+w2/m1+m2 pairs. Existing matches are unchanged
   unless the organizer explicitly uses the narrowly guarded correction below.
5. Full round robin: 4 teams → 6 encounters/24 games/6 waves; 5 → 10/40/10;
   6 → 15/60/16. Every player gets 6, 8 or 10 RR games respectively. Five teams
   get one bye each. See PORT §16 and robinBlocks() for verified schedules.
   Six teams are rest-balanced: nobody plays more than two blocks in a row or
   waits more than one. The order applies to new draws; stored draws are kept.
6. After all four valid scores: more games won wins; 2–2 uses total points;
   equal points requires an explicit organizer-recorded winner. No DreamBreaker.
7. Standings use round robin only: squad wins, game difference, point difference,
   points scored, setup slot. Top four seed 1v4 and 2v3. With four squads all
   qualify. Semifinal winners play a four-game gold final while the losers
   play a four-game bronze match in the same block (gold courts 1–2, bronze
   3–4), so bronze adds no time. Total games: 40/56/76.
8. Create playoffs only after EVERY distinct RR opponent pairing is resolved,
   then gold and bronze together only after both semifinals resolve. Membership and all lineups
   lock at generation; no routine edits during play. Only untouched legacy
   draws get the one-time opening-pair correction described below.
9. Personal records/ratings apply per game; never rate the aggregate result a
   second time. Casual mode stays unrated. No rating tuning in this update.
10. Protect bracket dependencies: remove only the last completely unplayed
    playoff stage before an upstream correction; never discard scored stages.
11. Test real workflows for all three counts, all gender compositions, preserved
    partner assignments, byes, cap/duplicate/outsider validation, top-four seeding,
    tie resolution, gold/bronze pairing and podium, rest balance, and old
    six-team schedule compatibility.
12. Earlier unscored draws: offer an explicit, confirmed opening-pair correction
    to the organizer/superadmin. Keep mixed partners and roster fixed. Reject
    any recorded score, void, score-entry metadata, rating event, playoff or
    prior correction. A closed unscored test can be corrected without reopening.
    Atomically preserve all match identities, timing, courts and opponents;
    update opening pairs and audit the change under the scoring session lock.
    Existing scored draws and ratings must not be rewritten.

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
Migrations: `drizzle/0014_groovy_rachel_grey.sql` and `0015_hot_spirit.sql`
(additive, no automatic old match edits). Backups include new lineup columns.

`rules.test.ts` proves coverage, no double bookings, pair stability, scoring
hierarchy and exact-tie handling. `workflow.integration.test.ts` runs the real
server actions against guarded development storage through all 72 games, fixed
rebuilds, permissions, backups, concurrent rating replays and rollback.

Do not copy our dated historical epochs blindly. Preserve the native app's own
past results; introduce any adopted tuning change at its own release boundary.

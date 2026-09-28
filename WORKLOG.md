# Shared work log

## Released: explicit Mini MLP lineups — Codex, 2026-09-27

Implementation branch codex/mlp-partner-review, baseline ef1c9f9; merged to main.
Active checkout main. This resolves the investigation
below: user clarified that organizers choose four category-specific pairs
(men, women, mixed 1, mixed 2), fixed for the session. It is NOT two pairs playing
both opposing pairs. All gender combinations remain allowed.

- New setup explicitly selects opening women/men pairs independently from the
  two mixed pairs. Each wave uses the four squad members exactly once. New
  draws require all four categories; RR and playoffs use the saved selections.
- Additive migration 0015_hot_spirit adds nullable women1/2, men1/2 player FKs.
  Old null rows keep their original opening slots for compatibility. No auto
  changes to existing draws, score history or rating tuning.
- One-time correction UI for entirely untouched old draws: organizer/superadmin
  can review opening pairs, including on closed test sessions. Server rejects
  score/void/entry metadata, rating events, playoffs, changed mixed pairs/roster,
  unauthorized callers or a second correction. Session lock serializes scoring;
  audit records before/after. Match identity/time/court/opponents/status survive.
- Team standings expand all four lineups. English, Simplified/Traditional Chinese
  and v1.7 notes updated; PROJECT, PORT and PORT-v1.7 describe the new rule.
- Checks: 338 standard tests pass; all six development DB workflows pass in
  162 seconds, including complete 4/5/6-team tournaments and independent lineup
  assertions for every RR/playoff game. Typecheck, lint and final build pass.
- Browser: five-team setup saves explicit opening selections, creates 40 games,
  locks the setup, displays all four categories and has no mobile overflow.
  Legacy correction was exercised on a synthetic closed draw: all 40 games
  retained, mixed games bit-identical, status remains closed, correction locks.
  Screenshot: ignored .scratch/v1.7-explicit-lineups.png. Fixture cleaned up;
  temporary browser tab closed and development server stopped.
- Migration applied to development and production successfully after backup:
  local-backups/v1.7-lineups-before-2026-09-27T20-50-06-394Z.json (ignored).
  Snapshot counts: 118 players, 125 seeds, 22 sessions, 222 signups, 204 rounds,
  449 matches, 1540 rating events, 118 stats, 6 MLP teams, 15 encounters.
  Post-migration hashes confirm matches/seeds/events/stats/rounds/encounters and
  existing team fields unchanged. Authentication data excluded from backup.
- Rollback tag backup/v1.7-before-explicit-lineups points to ef1c9f9 and is pushed.
  Release commit 5f73ed9 is on origin/main. Vercel deployment
  H4rQSs3fGHHDT862zVqXy6ZWWTRx reports success; public /notes returns HTTP 200,
  version 1.7 and the explicit-lineup note. No production lineup correction has
  been performed; the organizer chooses opening pairs explicitly in the UI.
  No implementation work remains. This final documentation entry records the
  verified deployment; future agents can start a new task from main.

## Investigated: Mini MLP opening-game partners — Codex, 2026-09-27

Branch: codex/mlp-partner-review, baseline ef1c9f9. Product code unchanged.
User reported that an organizer-selected mixed pair was split in the draw.

- Read-only production audit found one closed six-team Mini MLP session, with
  60 scheduled games and no completed scores. Every game matches the current
  generator; all five designated fixed-pair games preserve the reported pair.
- Cause: opening doubles use w1+w2 and m1+m2 (the two Player 1s / Player 2s),
  whereas fixed-pair games use m1+w1 and m2+w2. After gender restrictions were
  removed, slot order can produce an unintended mixed pair in opening doubles.
  This is a product-rule/setup mismatch, not a saved-pair mutation.
- 15 Mini MLP rule tests pass. Current pair-stability assertions cover the two
  fixed-pair games only; they do not promise one partner across all four games.
- Asked user whether selected pairs must stay together in every game (each
  pair faces both opposing pairs), or whether opening gender doubles should
  remain where possible before the two fixed mixed-pair games. Await that rule
  decision before changing generation, labels, or existing draws.
- No production writes, migrations, release, or rating changes. Audit script is
  ignored at .scratch/audit-mlp-partners.mjs. If rules change, update PORT and
  PORT-v1.7 and test all team counts and playoff stages with independent
  assertions of the selected rule. Existing session has no scores but must not
  be reopened or rebuilt without including that action in the agreed scope.

## Completed: flexible Mini MLP within v1.7 — Codex, 2026-09-26

Baseline e5c8984, implementation branch codex/v1.7-flexible-mlp, merged to main.
Active checkout: main; no active work remains. User requested 4/5/6 teams
and clarified that every gender combination is valid, including all men or all
women. This supersedes the original six-team/gender constraints below.

- Four courts and four players per team remain fixed; capacity=16/20/24 selects
  the count. Complete RR schedules have 6/10/15 encounters and 24/40/60 games.
- Top four still qualify (all teams when there are four). Five teams get one bye
  each. Two fixed pairs and the opening lineups remain locked during play.
- Neutral labels: each fixed pair has Player 1 (legacy w slot) and Player 2 (m).
  Opening doubles pair the two Player 1s and two Player 2s; then fixed pairs play.
- Keep schema, historical matches and the six-team schedule unchanged. No DB
  migration or rating retuning. All three languages, PORT and PORT-v1.7 updated.
- Files: MLP rules/actions/setup/board + new MlpTeamCount selector; session
  create/edit capacity guards, play-page count prop, three dictionaries, shared
  map and both port files. Schema changes are comments only.
- 336 standard tests pass; five opt-in DB workflow tests pass separately on
  pickleplay_dev. Complete 36/52/72-game tournaments checked through finals;
  real profiles cover all-men, all-women, 3+1, 1+3, 2+2 and unspecified gender.
  Tested unique opponents, equal workloads, five-team byes, lineup locking,
  capacity validation, top-four seeding, ties and existing fixed-pair safeguards.
- Browser: edited capacity 5→6→5; create form selects 4 teams/16 players;
  unrestricted 20-option setup saved; five-team draw created 40 games/10 waves.
  Neutral game labels and mobile standings verified without horizontal overflow.
  Added spacing between mobile standings columns. Development preview at
  ignored .scratch/v1.7-flexible-standings.png.
- Typecheck, lint and final production build pass, including the mobile spacing
  adjustment. Synthetic development fixtures cleaned up; dev server stopped.
  Release commit 95e6556 is on origin/main. Vercel deployment
  2DCxjodWpqv93DTrPMvEQ67VP2RL reports success. Production /notes and / return
  HTTP 200; /notes contains the new flexible-team/all-gender text; dev-login
  stays 404. Version remains 1.7 in every language.
- Sanitized production backup saved to ignored local-backups/
  v1.7-flexible-before-2026-09-26T23-05-03-431Z.json: 116 players, 121 seeds,
  21 sessions, 198 signups, 180 rounds, 381 matches; no production MLP teams yet.
  No production data edits or migrations by this task. Rollback tag
  backup/v1.7-before-flexible-mlp points to e5c8984 and is pushed to GitHub.
- Production was in active use: at the final read-only comparison two scheduled
  matches had received their first scores (only status, score_a, score_b and
  entered_by changed). Eight rating events were added accordingly; the seed
  hash was unchanged. Do not restore the snapshot over these legitimate scores.
- Final documentation commit records verification only. Next agent can begin a
  new branch/task; read PROJECT/PORT-v1.7 for the revised slot/count rules.

## Original v1.7 release history (constraints superseded above)

## Completed: v1.7 — Codex, 2026-09-26

Baseline: main 0a9a320 (v1.6), 316 tests / 19 files, typecheck/lint/build pass.
Implementation branch: codex/v1.7-mini-mlp, fast-forwarded to main.
Active checkout: main. Rollback tag: backup/v1.6-before-v1.7.
User authorized implementation, all six review fixes, GitHub push and release.
Production migration 0014 is applied and deployment is verified. No active code
work remains. Next agent: start a separate branch for the next task.

### Mini MLP decisions

- Exactly 6 teams, 4 players per team (2 men + 2 women), 4 named courts.
- Complete single round robin: 15 team encounters, four doubles games each
  (women, men, mixed 1, mixed 2). 60 individual games / 10 games per player.
- Two courts per encounter: gender doubles first, then mixed doubles. At most
  two disjoint encounters at once. The incomplete screenshots are inspiration,
  not the schedule to copy. Do not omit any of the 15 team pairings.
- Top four: 1v4, 2v3, then championship final. No DreamBreaker, no bronze requested.
- Encounter winner: most games won; at 2–2, higher total points across all four.
  Equal totals: organizer explicitly records winner (confirmed by user).
- Each team defines mixed pairs at setup: m1+w1 and m2+w2. User revised the
  earlier answer: no partner changes during the session, even before scoring.
  Pairings lock when the schedule is created and carry through the playoffs.
- Existing personal rating engine applies to individual games only; do not rate
  team-encounter wins a second time. No changes to historical rating constants.

### Also required

1. Preserve fixed pairs in incremental/rebuilt draws; enable live pair editing.
2. Enforce round ownership/void protection/private-preview authorization.
3. Complete backup coverage, including rounds, brackets and profile fields.
4. Publish rating caches atomically and serialize recomputes across requests.
5. Enforce gender restriction ahead of partner rotation, including fallback paths.
6. Refresh PORT through v1.7, and maintain shared agent handoff documentation.

### Validation and release status

Implementation complete. All six findings above are addressed.

- Mini MLP: `src/lib/mlp/`, `src/components/mlp/`, session forms/pages,
  schema/migration 0014, all three dictionaries and v1.7 release notes.
- Fixed pairing and gender constraints: `matchmaking/fixed.ts`, generator/service;
  transaction-protected roster/partner edits in `sessions/actions.ts`.
- Score/void/discard permissions and bracket dependencies: play-actions/MLP guards.
  Private metadata and OG images return generic content.
- Transaction helper, rating replay serialization and complete backup snapshot:
  `db/transaction.ts`, `rating/service.ts`, `db/backup.ts`, cron backup route.
- Added account-deletion explanation for assigned MLP players. Preserved original
  medal positions when a gold match is voided (bronze remains third/fourth).
- Shared map/handoff: AGENTS, PROJECT, README, WORKLOG, refreshed PORT and PORT-v1.7.

Validation (2026-09-26):
- 328 standard tests pass; 3 DB integration tests opt-in and pass separately.
- Real server actions tested on guarded pickleplay_dev: all 72 tournament games,
  exact team ties, locked mixed partners/roster, dependent bracket corrections,
  8-team fixed round robin/rebuild, authorization, backups, concurrent rating
  replay and transaction rollback. Synthetic test data cleaned up.
- Typecheck, ESLint (no warnings) and optimized production build pass.
- Browser verified setup, draw, semifinals, final and standings at mobile width;
  no horizontal overflow. Preview: ignored .scratch/v1.7-mobile-bracket.png.
- Upgraded Next/eslint-config-next from 16.2.12 to patched 16.3.6 after audit
  found critical runtime vulnerabilities (GHSA-2xp9-vwfh-vxw4). Updated transitive
  nanoid. Production dependency audit: zero vulnerabilities. Seven dev-only audit
  advisories remain; no forced major toolchain upgrades performed.

Release safety:
- Local rollback tag backup/v1.6-before-v1.7 points to 0a9a320.
- Sanitized production backup: local-backups/v1.7-before-2026-09-26T18-06-55-666Z.json
  (ignored, never committed); 115 players, 119 seeds, 20 sessions, 190 signups,
  153 rounds, 327 matches, 1,292 rating events and 115 player stats.
- Migration 0014_groovy_rachel_grey applied successfully to development and
  production. Additive tables/columns/enum only; old code remains compatible.
- SHA-256 comparison after migration: match history, seeds, rating_events and
  player_stats all unchanged. No production test sessions or score edits.
- Release commit b9953ce pushed to origin/main, plus the rollback tag.
- Vercel deployment A5cFFxoaiKNHbxAxDQiU2hgTpMFA reports success via GitHub
  commit status. Public /notes returns HTTP 200 and v1.7 Mini MLP content;
  homepage returns 200; /api/dev-login remains 404 in production.
- This final documentation-only commit records verification; product code is
  identical to tested/deployed b9953ce. No additional migration is needed.

Known intentional limits:
- Mini MLP roster/mixed partners lock when the full schedule is generated.
- Upstream result corrections require removing the last unplayed playoff stage;
  results feeding an already-scored playoff remain locked.
- Four games use the same entered score units; traditional/rally scoring is not
  a separate app mode. Exact aggregate ties need an organizer-recorded winner.
- iOS remains an independent app and must preserve its own historical epochs.

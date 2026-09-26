# Shared work log

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

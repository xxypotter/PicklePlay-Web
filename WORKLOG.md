# Shared work log

## Released: v1.8 Mini MLP court extension — Codex, 2026-10-02

Branch codex/mlp-six-courts from main 7428143. Reviewed Claude's v1.8 and
the preceding explicit lineups, bronze/rest balance, search, Back to setup,
0–0 clearing and Copy with players releases before editing. Version stays 1.8.

Completed and deployed. Main/origin/main contain release b6b8b8c (implementation
b4b1a42 plus independent tests). Vercel deployment 3uy3qNu81x29fe2sQ4FU47qiYKWh
reports success. Public home and /notes return 200, the new court note is live,
and /api/dev-login remains 404. No migration needed. Active checkout: main.
The final documentation-only commit records verification; no task remains open.

- Mini MLP accepts 4–6 courts; other formats keep their four-court cap.
  Shared sessions/limits.ts applies to create/edit forms, server validation,
  and copying. Copies retain all five/six court labels. An edit's UPDATE now
  checks status=open atomically so a concurrent Start cannot change drawn courts.
- New pure mlp/schedule.ts: preserves all four-court schedules; six teams on
  five courts use 12 full waves, on six courts 10. Five-court construction:
  three four-wave blocks, each with a different pair of squads on court 5
  playing four games sequentially; remaining squads play two opponents on
  courts 1–4. Each squad faces every opponent once, each player plays ten
  games/rests two waves, all saved category lineups are preserved.
- Four/five squads keep four active courts and their existing bye order;
  any extra booked courts stay free. Playoffs still use courts 1–4: two waves
  of 1v4/2v3, then two waves of gold/bronze. No extra-team expansion.
- appendSchedule persists explicit per-game waves/courts; never derive a wave
  as block*2 for the five-court layout. Monotonic playedAt per wave is retained.
  No schema migration, rating retuning, or historical draw rewriting.
- UI hints explain sequential court 5 / spare courts, in all three languages.
  v1.8 release note added; PORT.md, PROJECT.md, PORT-v1.8.md updated, and the
  v1.7 handoff points to the amendment. Superadmin permissions already apply
  equally to multiple accounts; stale single-owner comments/docs corrected.
- Checks: 365 standard tests pass; all 20 opt-in development DB workflows pass
  (15 MLP tests on final rerun, five setup tests from initial run). Covers all
  nine team/court combinations, incomplete 23/24 roster, saved pair integrity,
  collision-free courts/players, scoring/ties, seeding, gold/bronze, copy/edit,
  Back to setup, backup structure and atomic rating replay. Initial backup test
  expected the old 20 waves; corrected to 16 for five courts and reran MLP.
  Typecheck, lint, production build pass. Browser: saved six courts, restored
  five, started a synthetic session and generated the draw; Matchups displayed
  all 12 rounds with five courts each, the fixed lineup on court 5, and the
  sequencing hint. Development browser fixtures removed after verification.
- Production target identified unambiguously: HUI's OPEN "Mini mlp",
  2026-10-03 14:00 America/Chicago, id 8dd364e2-33f6-4459-82f2-f5df2897bfa8.
  Read-only audit: four courts, 23/24 players, no saved teams/draw/results.
  The other three closed Mini MLP sessions are tests and must stay untouched.
  User additionally explicitly requested promoting HUI to Jason's superadmin
  role, with no public release-note mention. Backup and guarded update script
  are ignored under .scratch/ and local-backups/, exclude PIN hashes/tokens.
- Local code commit: b4b1a42. Rollback tag: backup/v1.8-before-mlp-courts
  at 7428143. First publication attempt never executed: automatic approval
  review hit an account usage limit. User then requested continuation and an
  independent agent's additional tests. Git fetch now succeeds; main and
  origin/main remained 7428143 until the successful release recorded above.
- Independent agent Hooke authored independent-audit.test.ts (56 tests), then
  hit its account usage limit before supplying a final review verdict. Parent
  reviewed and executed the suite successfully: all nine team/court combinations,
  576 ordered lineup assignments per team position, all 720 six-team orderings,
  randomized lineups, chronological collision/overlap checks, frozen four-court
  compatibility, real actions with mocked persistence, playoffs and UI boundaries.
  These supplement, not replace, the earlier 20 real development DB workflows.
  Final regression: 421 standard tests pass; typecheck and lint pass. Production
  build passed on b4b1a42; only independent tests/documentation added since then.
- Owner-requested BoRong account recovery completed through the existing scrypt
  implementation. Verified exact active player account; stored hash verifies the
  requested PIN, prior sign-in sessions revoked and eight old login-attempt rows
  cleared; audit entry attributes recovery to Jason. No credentials committed.
  The normal reset form rejects sequential PINs; this was a one-time explicitly
  requested override, not a change to public PIN validation. No active lockout
  existed at the read-only audit. No match/rating records changed for recovery.
  Do not claim a completed browser sign-in: verification was hash + account/rate
  checks, not impersonating the player in the UI.
- Production changes completed after successful deployment and a fresh sanitized
  backup: local-backups/v1.8-courts-before-2026-10-02T21-52-43-580Z.json.
  HUI's October 3 session now has courts 1,2,3,4,5; HUI and Jason both have
  superadmin. Both changes are audited under Jason. The role change is deliberately
  absent from public revision notes. No real draw generated or test scores entered.
  Comparison of all ten backed-up tables is identical after excluding only the
  requested HUI role and target session's court fields; 549 matches, 127 seeds,
  1,540 rating events and all existing team lineups remain unchanged. This snapshot
  was taken after BoRong's recovery and excludes PIN hashes and auth tokens.
  Browser confirms Sat Oct 3, 2 PM, courts 1–5. Screenshot (ignored):
  .scratch/v1.8-tomorrow-courts.png.
- Organizer readiness: still 23/24 confirmed, zero saved teams and no draw. HUI
  must add the last player and save all six teams/four category lineups before
  generating the real schedule. The software has been rehearsed with synthetic
  complete rosters; do not describe this incomplete real roster as already drawn.
- Recovery note: the rollback tag restores the preceding code. Before any
  rollback, inspect whether a five/six-court draw has since been played. Do not
  blindly restore four-court settings on a draw using court 5/6 or restore a
  stale snapshot over new scores. If new-court games exist, preserve the new
  validation and stored schedule while fixing forward. Current pre-release
  target has no draw, so its two court fields are still independently reversible.

## Released: v1.8 — Claude, 2026-09-30

Branch claude/v1.8 from main 425cf18. Version bumped to 1.8.

- Dropped by the user after discussion: a one-off "special event" (清华 vs 交大,
  2026-11-07, 10 teams of 6, pipelined 10-court schedule). Not built; nothing
  remains in code. Its input screenshot folder `special event/` is git-ignored.
- Format picker order (create and edit): Mini MLP now above Custom. Server-side
  format lists are validation sets only and were left unchanged.
- Matchups: your own name reads "You (username)" / 你（username） instead of a
  bare "You", on score cards, read-only rows and voided cards. The old
  common.you key was replaced by common.youNamed so no caller can miss it. The
  player-filter chip still says "You"/"我" (schedule.filterYou) by choice.
- Release notes v1.8 (notes.v18.youNamed, notes.v18.formats) in all three
  languages; PORT §4 order and §7 layout note updated.
- Checks: 351 tests pass, typecheck, lint, build. Browser (dev): create form
  order Regular, Balanced, Gender, Fixed, Mini MLP, Custom; dev_cara (zh-Hans)
  sees 你（dev_cara） on read-only rows; dev_ana sees "You (dev_ana) & dev_ben"
  on score cards; Me shows version 1.8.
- Released: c7aac01 fast-forwarded to main and pushed. GitHub commit status
  success; public /notes (HTTP 200) showed version 1.8 and its notes about 60
  seconds after push. Code-only, no migration. No work remains on this branch.

## Released: Back to setup with a draw, 0–0 clearing, Copy with players — Claude, 2026-09-28

Branch claude/setup-and-copy-players from main 32eb7e9. Version stays 1.7.
User decisions (asked and answered): Back to setup for EVERY format, organizer
only, only while no score exists; a mistaken score is cleared by the organizer
entering 0:0. Copy gets two options; "with players" copies everyone signed up
(confirmed + waitlist, in order) and also Mini MLP teams/lineups or fixed pairs.

- reopenSessionAction (play-actions.ts): organizer; under lockSession, refuses
  if any match is non-scheduled or has a score (err.resultsExist); deletes
  matches, mlp_ties, rounds; live→open; audit session.back_to_setup. Signups,
  mlp_teams, partner pairs kept.
- saveScoreAction: 0–0 by the organizer (canOrganizeSession) clears a completed
  match to scheduled, nulls scores/enteredBy/editedAt, audit match.clear with the
  old score; guardMlpResultChange applies; others get the tie error. MatchCard
  canClear prop (play console always; session page for organizer) turns Save
  into "Clear score" at 0–0.
- ReopenSessionButton now shown whenever live: one tap before a draw, confirm
  when a draw exists, explanation (no action) when results exist.
- Copy: pure copyRoster/teamsCarryOver/pairsCarryOver in sessions/copy.ts; new
  sessions/copy-source.ts (loadCopySource, shared visibility rule, moved from
  the create page). Create page ?players=1; form preselects players (waitlist
  beyond capacity), notes whether teams/pairs carry over, posts copyFrom.
  createSessionAction re-reads teams/pairs from the source, validates against
  confirmed players, inserts in one transaction; invite ids deduplicated.
- Strings in three languages; notes.v17.backToSetup/copyPlayers; startedHint
  updated. PORT §5, §9, v1.6 copy and PORT-v1.7 scope updated.
- Checks: 360 tests incl. all dev DB workflows pass (new copy.test cases and
  sessions/setup.integration.test.ts: regular + MLP back to setup, 0–0 by
  player/other admin/organizer, audit rows, redraw after team edit, copy with
  teams/partial/pairs/waitlist/private source). Typecheck, lint, build pass.
- Browser (dev, dev_ana): finished MLP fixture shows both copy buttons; Copy
  with players preselected 16/16 and "All 4 teams…"; unticking flips the note;
  created session had the 4 teams and lineups; started, drew 24 matches, scored
  one; Back to setup explained; 0–0 showed Clear score and cleared it; Back to
  setup confirmed "Deletes all 24…", returned to open with teams editable.
  Fixtures, four temporary dev_ accounts and test audit rows removed.
- Released: 35bb628 fast-forwarded to main and pushed. GitHub commit status
  success; public /notes (HTTP 200) showed the new notes about 60 seconds after
  push; home HTTP 200. Code-only: no migration, no production data touched.
  No work remains on this branch.

## Released: player search on the play console — Claude, 2026-09-28

Branch claude/play-player-search from main a051e2d. User approved extending
the search below to the play console's "Add someone who didn't sign up".

- src/app/s/[id]/play/PlayControls.tsx AddPlayers now uses PlayerSearch +
  matchPlayers exactly like Edit's Add players (an add clears the box; Enter
  adds the single match). v1.7 note and PORT §7 now say create, edit or run.
- Checks: 348 tests, typecheck, lint, build pass. Browser (dev, dev_ana, open
  "Copy test — main" fixture): "fa"+Enter added dev_fay, tap added dev_cara,
  box cleared and kept focus, section stayed open, 375px no overflow. Test
  signups removed afterwards.
- Released: 0f99eba fast-forwarded to main and pushed. GitHub commit status
  success; public /notes returned HTTP 200 with the updated note about 50
  seconds after push. Code-only. No work remains on this branch.

## Released: player search on create/edit session — Claude, 2026-09-28

Branch claude/player-search from main 25407d0. User asked for a letter search
so organizers can find a player to add; version stays 1.7, note added.

- New src/lib/players/search.ts matchPlayers(): any-part match ignoring case,
  accents and full-width letters; prefix matches first, else list order.
  New src/components/PlayerSearch.tsx input (✕ / Escape clear; Enter picks the
  single match and never submits the create form).
- Used in src/app/sessions/new/SessionForm.tsx (invite grid) and
  src/app/s/[id]/edit/RosterEditor.tsx (Add players). A pick clears the box.
  "Select all" is unchanged (first N of the whole roster).
- Not added to the play console's "Add someone" list (not requested); it uses
  the same pattern and could take the same component.
- Strings search.players/clear/none and notes.v17.playerSearch in all three
  languages; PORT §7 layout note.
- Checks: 348 tests pass (new search.test.ts); typecheck, lint, build pass.
  Browser (dev, dev_ana): create — filter "an", tap pick, "KIT"+Enter picks
  without submitting, "zz" shows no-match, ✕ restores; edit — tap and Enter
  add via server action, section stays open; 375px has no overflow; no console
  errors. Two test signups on the dev "Copy test — main" fixture removed.
- Released: 3d526f1 fast-forwarded to main and pushed. GitHub commit status
  success; public /notes returned HTTP 200 with the player-search note about
  40 seconds after push. Code-only; no migration or data changes. No work
  remains on this branch.

## Released: Mini MLP bronze, rest balance, gender labels — Claude, 2026-09-28

Branch claude/mlp-bronze-rest-labels from main 6169b41. Follows a review of
Codex's v1.7 Mini MLP against the user's request. User decisions: HUI's closed
Oct 3 MLP session is a test (leave it alone); keep up to six teams and revisit
evening length later; add a bronze match, gender labels and rest balancing.
Version stays 1.7 (unreleased-to-users follow-up, same precedent as Codex).

- Bronze: once both semis resolve, one action draws gold (winners, courts 1–2)
  and bronze (losers, courts 3–4) in the same block and waves, so it adds no
  time. No schema change: both are stage `final`; creation order says which is
  gold. New pure helpers finalsOf/semiResults/podium in rules.ts. Board shows
  both cards and a 🥇🥈🥉 podium. Removing an unplayed final removes both.
  A pre-bronze final (single encounter) still reads as gold alone.
- Rest balance: six-team robin order replaced after exhaustive search — max two
  blocks in a row and max one block waiting, versus one squad playing four in
  a row before. Five teams were already at their floor (one bye per block);
  four teams never rest. New draws only; stored draws are never regenerated,
  so the production test session is untouched.
- Gender labels: setup dropdowns show "name (F)/(M)" (nothing for unspecified).
  Information only; no filtering or validation, any mix still allowed.
- zh-Hant: three MLP strings said 準決賽 while the rest of the app (13 places)
  and the same screen's headings say 半決賽; aligned to 半決賽.
- Files: src/lib/mlp/rules.ts, actions.ts, rules.test.ts,
  workflow.integration.test.ts; src/components/mlp/MlpBoard.tsx, MlpSetup.tsx;
  three dictionaries; release-notes.ts (notes.v17.mlpBronze); PORT, PORT-v1.7,
  PROJECT.
- Checks: 343 standard tests pass (new: rest-balance bound, confirmed to fail
  on the old order; semi pairing; gold/bronze/podium; legacy single final).
  All six dev DB workflows pass on pickleplay_dev with 40/56/76-game totals,
  bronze courts 3–4, podium, and remove/redraw of an unplayed final.
  Typecheck, lint and production build pass.
- Browser (dev, dev_ana): 4-team fixture — labels in mixed and opening
  dropdowns, real draw/semis/final buttons, gold+bronze in block 5, podium
  Dinks/Ernies/Kitchen, zh-Hant 銅牌賽; no console errors. Fixture sessions and
  four temporary dev_ accounts purged; dev server stopped.
- Released: dfbc927 fast-forwarded to main and pushed (branch pushed too).
  GitHub commit status success; public /notes returned HTTP 200 with the new
  v1.7 bronze note about 20 seconds after push. Code-only: no migration, no
  production data touched, no rating changes. No work remains on this branch.

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

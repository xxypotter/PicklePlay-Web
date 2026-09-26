# PicklePlay — shared project map

Read WORKLOG.md for the active task and verified release status. Both Codex and
Claude Code use AGENTS.md. Code and tests take precedence over the older SPEC.md.

## Stack and deployment

Next.js 16.3.6 App Router, React 19, TypeScript, Tailwind 4, Drizzle and Neon
Postgres. Public app: https://pickle-play-web.vercel.app/ . Git remote:
https://github.com/xxypotter/PicklePlay-Web . Production follows main on Vercel;
verify deployment after pushing, not just that git accepted the commit.
Product version comes from src/lib/release-notes.ts, not package.json.

Development DB: pickleplay_dev. Production DB: neondb. Never print connection
strings. Local .env.local holds separate URLs; db:migrate targets development,
db:migrate:prod uses DATABASE_URL_PROD_UNPOOLED. Additive migrations go out before
the code that depends on them, after backup and development validation.

## Product and source map

- Mobile doubles organizer: regular, balanced, gender-balanced, fixed partners,
  custom rounds, and Mini MLP (v1.7).
- Session lifecycle and score writes: src/lib/sessions/. UI: src/app/s/[id]/.
- Planners: src/lib/matchmaking/; whole-session plans versus incremental rounds.
- Rating engine: src/lib/rating/engine.ts; tuning epochs: constants.ts;
  database replay/cache publication: service.ts.
- Truth: matches + rating_seeds. rating_events and player_stats are rebuilt
  caches. Preserve old epochs and playedAt; no new rating tuning is requested.
- Authorization: auth/policy.ts (pure), permissions.ts and sessions/guards.ts.
  Every action must enforce its own resource ownership and state checks.
- Roles: player, admin, one superadmin. Organizers manage their own sessions;
  superadmin can manage any. Closed-session scoring is organizer/superadmin only.
- Three dictionaries in src/lib/i18n/dictionaries/: English, zh-Hans, zh-Hant.
  Add every key in all three, preserving placeholders.
- Player record includes casual games; rating caches include rated games only.
- Backups: src/app/api/cron/backup/route.ts; weekly Vercel cron. Exclude PIN
  hashes, tokens and invite secrets. Recovery must include all session structure.
- PORT.md is the behavior handoff to a separate iOS app, with independent users,
  data and ratings. Do not require that app to copy our historical epochs.

## Working and release checks

1. Read this file, WORKLOG and git status; read bundled Next docs for APIs touched.
2. Work on a codex/* or other explicitly coordinated branch. Leave personal input
   directories untracked. Do not run another agent's task in the same checkout.
3. Test pure rules, then important server-action/DB workflows on development.
4. Run npm.cmd test, npm.cmd run typecheck, npm.cmd run lint, npm.cmd run build.
5. Update release notes in all languages, PORT and WORKLOG. Scan staged changes
   for credentials, database URLs and private inputs.
6. Preserve a rollback ref and sanitized data snapshot before a production
   migration. Never include credentials in the snapshot or commit it.
7. Push tested changes, verify the Vercel deployment and public notes. Record
   commit, migration, checks, and any remaining limitations in WORKLOG.

## Intentional behavior

Score entry accepts either rally or traditional scoring (integer 0–99, no tied
individual games). Margin versus expectation drives personal ratings, so a close
loss can gain rating. Reliability declarations remain as previously approved;
changing their policy is not part of v1.7. Automatic closure is 48h after startsAt.
Player capacity normally follows courts (6 per court), maximum 4 courts.

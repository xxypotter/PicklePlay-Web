# PicklePlay

Mobile pickleball session organizer, personal ratings and match records.
Production: https://pickle-play-web.vercel.app/

Read [PROJECT.md](PROJECT.md) for architecture and release instructions,
[WORKLOG.md](WORKLOG.md) for current status, and [PORT.md](PORT.md) for the
independent iOS handoff. Codex and Claude Code share [AGENTS.md](AGENTS.md).

Use Node.js and `npm.cmd ci` on Windows, then `npm.cmd run dev`. Configure
`.env.local` from `.env.example`; local work uses the `pickleplay_dev` database.
Never point development login or synthetic tests at production.

Checks: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`,
`npm.cmd run build`. Integration checks are opt-in:

```powershell
$env:RUN_DEV_INTEGRATION = '1'
npm.cmd test -- src/lib/mlp/workflow.integration.test.ts
Remove-Item Env:RUN_DEV_INTEGRATION
```

Generate migrations with `npm.cmd run db:generate`; apply to development first
with `npm.cmd run db:migrate`. Back up production and verify tests before
`npm.cmd run db:migrate:prod` and a release push. Never commit credentials,
database exports or personal input screenshots.

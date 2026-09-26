<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Shared handoff (Codex and Claude Code)

Read `PROJECT.md` and `WORKLOG.md` before starting work. They are the shared
project map and current task handoff; `CLAUDE.md` includes this file too.
Check git status and the active branch. Do not overwrite another agent's work.
Use separate branches/worktrees for concurrent tasks; one agent owns a release.
Update WORKLOG with decisions, files changed, checks and deployment status before
handing off. Update PORT.md when product behavior changes (the iOS app is independent).

Never commit .env files, database exports, credentials, or personal screenshots
from `pressure test/`, `dupr forecast/`, or `mini MLP input/`. Keep development
tests on `pickleplay_dev`; production migrations use the separate prod config.
Do not retune historical rating epochs or rewrite real match records to test a feature.
On PowerShell use `npm.cmd`, since execution policy may block npm.ps1.

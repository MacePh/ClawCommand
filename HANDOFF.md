# ClawCommand Handoff

## Project
- Location: `F:\ClawCommand`
- Goal: cross-platform hybrid agent command center (Windows + Linux friendly), web-first.

## Stack
- Frontend: Vite web app (`src/main.ts`, `src/style.css`)
- Backend: small Node/Express API (`server.js`)
- Persistence: local JSON files in `data/`
- OpenClaw integration: shell-outs to `openclaw status` and `openclaw sessions --json`

## Current status
- Scaffolding created.
- Hybrid v1 shell built with:
  - top status bar
  - live activity feed
  - task intake form
  - kanban board (To Do / Doing / Done)
  - OpenClaw status panel
  - sessions/workers panel
- Local persistence files auto-created in `data/`.
- Manual refresh endpoint added.

## Relevant files
- `package.json`
- `server.js`
- `src/main.ts`
- `src/style.css`
- `data/tasks.json`
- `data/events.json`

## Next steps
1. Add npm scripts for running frontend + backend together.
2. Improve OpenClaw session parsing/rendering (current API is tolerant but basic).
3. Add task edit/delete and drag-drop.
4. Add clearer agent cards / worker states.
5. Optionally add live polling/log-tail adapter instead of refresh-only status commands.

## Notes
- Web-first was chosen to stay dual-boot / cross-platform friendly.
- This is Option C: real OpenClaw visibility where easy, local task orchestration where backend APIs are not fully wired yet.

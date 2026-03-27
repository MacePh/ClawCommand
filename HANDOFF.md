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
- Hybrid dashboard now has a **real telemetry collector** on the backend.
- Every 10s, the backend polls OpenClaw status + sessions, detects diffs, and emits feed events for:
  - gateway/status snapshot changes
  - session count changes
  - session appeared
  - session disappeared
- Frontend feed now shows event metadata too.
- Existing kanban/task actions remain intact.

## Relevant files
- `package.json`
- `server.js`
- `src/main.ts`
- `src/style.css`
- `data/tasks.json`
- `data/events.json`

## Next steps
1. Add a single command to run frontend + backend together.
2. Improve telemetry quality (parse more useful structured status details instead of crude snapshot summaries).
3. Add richer worker cards and state badges.
4. Add task editing and persistent ordering.
5. Optionally add log-tail or SSE/WebSocket streaming instead of polling.

## Notes
- Web-first was chosen to stay dual-boot / cross-platform friendly.
- This remains Option C: real OpenClaw visibility where easy, local task orchestration where backend APIs are not fully wired yet.

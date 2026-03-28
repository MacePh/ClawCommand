# ClawCommand bolt.new Frontend Redesign Handoff

## What this is
This is an external handoff brief for rebuilding the **ClawCommand Vite frontend only** in bolt.new.

This is **not** a Boris-owned implementation task.

## Delivery boundary
- **Rebuild:** `src/main.ts` and `src/style.css` (or equivalent frontend-only Vite structure)
- **Keep unchanged:** `server.js`, API routes, queue/dispatcher runtime, workspace file layout, telemetry contracts
- **Do not redesign by changing backend semantics**
- **Do not invent new execution behavior**
- **Do not make the UI imply capabilities the system does not actually have**

## Status / priority
This is a **P3 deferred handoff**.

Only start after the base hardening work is closed:
- P0 dispatcher/runtime correctness
- P1 reliability/hardening work
- P2 honesty/usability fixes

Until those are done, treat this as a prepared redesign brief only.

## Product truth to preserve
ClawCommand is an **operator console**, not a fake sci-fi dashboard.
The redesign should optimize for:
- fast scanning
- truthful state
- queue-first operation
- low clutter
- obvious next actions

If a panel is decorative, ambiguous, or overclaims capability, remove it, demote it, or label it clearly.

## Non-negotiable constraints
1. **Backend API surface stays unchanged**
   - Existing routes and payloads remain the contract.
   - Frontend should adapt to current data, not require backend redesign.

2. **Queue is the real execution surface**
   - Workspace queue and dispatcher are real.
   - Any local kanban/planning views must stay clearly labeled planning-only unless they are actually wired to runtime behavior.

3. **Real state beats pretty state**
   - Prefer fewer working panels over many misleading ones.
   - Error states must be operator-friendly and explicit.

4. **Scanability matters more than decoration**
   - Titles first
   - Clear status grouping
   - Minimal copy
   - Strong visual hierarchy

5. **Keep operator actions obvious**
   - Approve / reject / bump / do-now style controls should remain easy to find where already supported.

## Redesign goals from prior work
The frontend rebuild should preserve and improve these already-established product directions:

### 1) Overview should stay minimal
Overview should focus on the core operator surface only:
- queue / active work
- command/runtime status
- workers/sessions
- immediate operator controls

Secondary detail belongs in deeper views, not all on the front page.

### 2) Queue-first UX
The queue is the heart of the product.
The redesign should make it easy to distinguish:
- proposed / awaiting approval
- approved and queued
- running now
- done
- needs attention / failed

The current trajectory already moved toward tabbed and lane-based separation; the redesign should refine that, not collapse everything back together.

### 3) Honest planning vs execution separation
The local planning board must never look like runtime truth.
If it remains in the redesign, it should be visually and verbally separated from the real queue.

### 4) Strong title-first cards
Queue, memory, and related records should be easy to scan without reading walls of text.
Use concise headings, short summaries, expandable details, and metadata that supports quick triage.

### 5) Triage visibility and freshness
Queue triage is useful, but only when clearly scoped and fresh.
The redesign should preserve:
- triage summaries
- related-task hints
- suggested execution-plan cues
- freshness indicators
- stale-state dimming / warnings

### 6) Better runtime honesty
Workers, sessions, service state, and refresh/error behavior should look operational, not theatrical.
Raw shell junk should never dump into the UI as the primary error presentation.

### 7) Reduce dashboard clutter
ClawCommand drifted toward an everything-at-once wall.
The rebuild should intentionally reduce visual noise and cognitive load.
Use spacing, grouping, and progressive disclosure instead of stuffing all data into one screen.

## Suggested information architecture
This is a recommendation, not a hard pixel spec.

### Primary views
- **Overview**
  - queue snapshot
  - running now
  - immediate controls
  - key runtime/session status

- **Queue**
  - active work lanes or tabs
  - proposed / queued / running / done / attention
  - triage annotations
  - task inspection and action controls

- **Runtime**
  - services
  - sessions/workers
  - health/state panels

- **Deep Dive / Memory / Diagnostics**
  - recent activity
  - working memory views
  - raw diagnostic detail when needed

### Recommended card behavior
- title first
- status pill visible immediately
- short metadata row
- expandable detail body
- action row pinned or consistently placed

## Visual direction
Target vibe:
- sharp operator console
- modern but restrained
- high information density without chaos
- dark theme friendly
- readable at normal zoom

Avoid:
- giant decorative hero sections
- fake cyberpunk dashboard nonsense
- oversized cards that waste viewport height
- hidden critical actions
- ambiguous color meaning

## Data and behavior assumptions bolt.new should respect
- Queue data comes from the existing backend/workspace queue model.
- Completed work and failed work already have distinct meanings.
- Session/runtime views may have partial or degraded data; frontend must handle that gracefully.
- Some panels depend on file-backed state, some on live OpenClaw/gateway data; the UI should make degraded/fallback states clear without panic.

## File references
Current project location:
- `F:\ClawCommand`

Relevant current files:
- `F:\ClawCommand\server.js`
- `F:\ClawCommand\src\main.ts`
- `F:\ClawCommand\src\style.css`
- `F:\ClawCommand\HANDOFF.md`

Context sources that drove this brief:
- `C:\Users\theve\.openclaw\workspace\memory\2026-03-27.md`
- `C:\Users\theve\.openclaw\workspace\memory\2026-03-28.md`

## Explicit handoff ask for bolt.new
Rebuild the ClawCommand Vite frontend into a cleaner operator-first UI while keeping the backend/API contract unchanged.

Success looks like:
- more readable at a glance
- more honest about what is real vs local-only
- better queue triage and action flow
- less cluttered Overview
- cleaner runtime/session surfaces
- no backend changes required

## Out of scope
- dispatcher redesign
- queue semantics changes
- new backend endpoints
- changing OpenClaw integration contracts
- re-architecting workspace memory or queue storage
- Boris implementing the redesign directly as part of this handoff

## Acceptance check
Before accepting a redesign, ask:
- Does it preserve backend compatibility?
- Is the queue clearly the real execution surface?
- Does the planning board stop pretending to be runtime truth?
- Is Overview actually lighter and more usable?
- Can an operator tell what needs action in a few seconds?
- Did we reduce clutter instead of just repainting it?

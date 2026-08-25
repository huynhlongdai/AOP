# AOP Clickable UI Prototype v0.1

This is the zero-build UX validation prototype created after Founding Company Meeting #009.

## Run

Open `prototype/index.html` directly in a browser.

No dependency install or build step is required.

## Implemented clickable views

- `#dashboard` — Executive Dashboard
- `#project` / `#projects` — Project Phoenix Workspace
- `#task` / `#tasks` — Task PHX-1402 Detail
- `#agent` / `#agents` — Backend Agent Detail

The sidebar also exposes the approved global information architecture. Non-slice pages intentionally show placeholders rather than fake product behavior.

## Review flow

Recommended walkthrough:

```text
Dashboard
  -> click Project Phoenix in Current Initiatives
  -> inspect Work Coordination Board
  -> click PHX-1402
  -> inspect authoritative inputs, run/lease, blocker, review and events
  -> click Backend Agent from sidebar or current assignment
```

## Design principles represented

- AI Organization OS mental model
- state over conversation
- evidence over self-report
- human attention over activity noise
- verified progress
- authoritative artifact/decision references
- bounded agent permissions
- task lifecycle separated from blocked condition
- discussion attached to work rather than treated as truth
- shared visual grammar for future entity detail pages

## Why zero-build first?

The repository has not started Slice 0 implementation yet. This prototype validates information architecture and interaction hierarchy independently from framework setup. Once approved, the component/route model should be transferred into the planned React + Vite `apps/web` implementation and backed by Query API + SSE.

## Source documents

- `docs/design/UX_UI_SYSTEM_v0.1.md`
- `docs/implementation/UI_IMPLEMENTATION_PLAN.md`
- `docs/meetings/008-ux-ui-alignment.md`
- `docs/meetings/009-frontend-prototype-kickoff.md`

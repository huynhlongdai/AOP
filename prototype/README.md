# AOP Clickable UI Prototype v0.2

This is the zero-build UX validation prototype created across Founding Company Meetings #009 and #010.

## Run

Open `prototype/index.html` directly in a browser.

No dependency install or build step is required.

## Implemented clickable views

### Operate

- `#dashboard` — Executive Dashboard
- `#project` — Project Phoenix Workspace
- `#tasks` — Task Board
- `#task-detail` — PHX-1402 Task Detail
- `#agents` — Agent Directory
- `#agent-detail` — Backend Agent Detail

### Truth & Control

- `#artifacts` — Artifact Registry
- `#artifact-detail` — API Specification Detail
- `#decisions` — Decision Registry
- `#decision-detail` — DEC-114 Decision Detail
- `#approvals` — Human Approval Center
- `#approvals-detail` — Protected Deployment Approval Detail
- `#schedule` — Schedule & Cron
- `#schedule-detail` — API Sync v2 Schedule Detail
- `#events` — Event Explorer
- `#event-detail` — Decision Approved Event Detail

### Knowledge

- `#knowledge` — Knowledge & Memory boundary overview

## Primary review flow

```text
Dashboard
  -> Human Attention / Approvals
  -> inspect protected deployment request
  -> related Task PHX-1402
  -> authoritative API Spec v4
  -> related DEC-114
  -> downstream impact
  -> Event Explorer / correlation chain
  -> Schedule / run history
```

A second useful flow is:

```text
Project Phoenix
  -> Task PHX-1402
  -> Backend Agent
  -> permissions / memory / tools
  -> Artifact v4
  -> Decision
  -> Event
```

## Design principles represented

- AI Organization OS mental model
- state over conversation
- evidence over self-report
- exceptions over noise
- verified progress instead of agent self-report
- artifacts are versioned authoritative outputs, not generic files
- decisions are explicit authoritative objects, not conclusions buried in chat
- approvals are durable human-control workflows
- schedules show human-readable time rule + timezone + raw cron
- activity, events, and traces are distinct observability levels
- cross-linked authoritative objects; no dead-end detail pages
- bounded agent permissions
- shared detail-shell visual grammar

## Why zero-build first?

The repository has not started Slice 0 implementation yet. This prototype validates information architecture and interaction hierarchy independently from framework setup. Once approved, the component/route model should be transferred into the planned React + Vite `apps/web` implementation and backed by Query API + ordered SSE organization events.

## Source documents

- `docs/design/UX_UI_SYSTEM_v0.1.md`
- `docs/implementation/UI_IMPLEMENTATION_PLAN.md`
- `docs/meetings/008-ux-ui-alignment.md`
- `docs/meetings/009-frontend-prototype-kickoff.md`
- `docs/meetings/010-truth-automation-attention-ux.md`

# AOP Clickable UI Prototype v0.3

This is the zero-build UX validation prototype created across Founding Company Meetings #009–#011.

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

## Meeting #011 scale/stress controls

The prototype now adds an overlay layer to stress-test the same information architecture at different organization sizes.

### Search + command palette

Press:

```text
Ctrl+K
```

or on macOS:

```text
Cmd+K
```

The palette demonstrates object navigation and operator commands without browsing deep flat menus.

### Ranked Human Attention

Click the top-bar `Attention` indicator.

The drawer shows ranked executive exceptions using structured concepts such as:

- severity
- blast radius
- authority requirement
- critical-path membership
- age
- repeated occurrence
- budget/policy impact

The ranking is conceptually deterministic before AI explanation.

### Organization scale fixture

Use the top-bar Scale control to cycle:

```text
12 agents
120 agents
1,200 agents
```

The underlying product mental model does not change. High-volume list pages instead demonstrate:

- saved views
- denser presentation
- aggregation
- cursor/pagination/virtualization expectations for production

### Hierarchical context

Use the top-bar context control to visualize:

```text
Organization
  -> Project
    -> Team
      -> Work / Workforce / Truth
```

Detail pages also expose explicit drill-up controls so deep navigation does not lose executive context.

## Primary review flow

```text
Dashboard
  -> Human Attention drawer
  -> protected deployment request
  -> Task PHX-1402
  -> API Spec v4
  -> DEC-114
  -> Event correlation chain
  -> return to Project / Dashboard
```

Then repeat the flow while cycling 12 / 120 / 1,200-agent scale fixtures.

A second useful flow is:

```text
Cmd/Ctrl+K
  -> search PHX-1402 / Backend Agent / stale artifacts
  -> deep detail object
  -> drill-up context
```

## Design principles represented

- AI Organization OS mental model
- state over conversation
- evidence over self-report
- exceptions over noise
- executive compression at organizational scale
- deterministic Attention ranking before AI summarization
- hierarchical context narrowing rather than menu explosion
- search/command palette as scale navigation
- progressive disclosure: executive -> operational -> diagnostic
- verified progress instead of agent self-report
- artifacts are versioned authoritative outputs, not generic files
- decisions are explicit authoritative objects, not conclusions buried in chat
- approvals are durable human-control workflows
- schedules show human-readable time rule + timezone + raw cron
- activity, events, and traces are distinct observability levels
- cross-linked authoritative objects; no dead-end detail pages
- bounded agent permissions
- shared detail-shell visual grammar

## Prototype implementation structure

```text
prototype/
  index.html
  app-v2.js        # core clickable AOP screens
  styles-v2.css    # core prototype extension styles
  ux-stress.js     # Meeting #011 scale/navigation stress layer
  ux-stress.css    # stress layer visuals
```

Legacy `app.js` and `styles.css` remain as earlier exploration references; `index.html` loads the current v0.3 stack.

## Why zero-build first?

The repository has not started Slice 0 implementation yet. This prototype validates information architecture and interaction hierarchy independently from framework setup. Once UX is frozen, the approved component/route model should be transferred into the planned React + Vite `apps/web` implementation and backed by Query API + ordered SSE organization events.

## Source documents

- `docs/design/UX_UI_SYSTEM_v0.1.md`
- `docs/implementation/UI_IMPLEMENTATION_PLAN.md`
- `docs/meetings/008-ux-ui-alignment.md`
- `docs/meetings/009-frontend-prototype-kickoff.md`
- `docs/meetings/010-truth-automation-attention-ux.md`
- `docs/meetings/011-ux-stress-scale-navigation.md`

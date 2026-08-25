# Founding Company Meeting #011 — UX Stress Review & Scale Navigation

Date: 2026-08-25
Status: Approved for prototype refinement

## Purpose

Stress-test the AOP UX/UI model from Meetings #008–#010 against realistic operating conditions: 10, 100, and 1,000+ agents, multiple projects, simultaneous approvals, large event volumes, and nested drill-down from organization state to a specific task/run/event.

The goal is not to add more modules. The goal is to determine whether a founder or executive can identify a meaningful exception quickly, understand why it matters, act with sufficient evidence, and recover organizational context afterward.

## Participants

- Founder representative
- Chief of Staff
- CEO
- CPO
- UX Lead
- Product Designer
- CTO
- Platform Architect
- Agent Systems Architect
- SRE/Observability Lead
- Security/Governance Lead
- QA/Evaluation Lead

## Stress scenarios

The team reviewed the prototype against four scale profiles.

### Scenario A — Small company

- 5–15 agents
- 1–3 projects
- fewer than 50 active tasks
- founder can still recognize most agents by name

### Scenario B — Growing organization

- 50–150 agents
- 10+ teams/projects
- hundreds of active tasks
- tens of approvals/risks per day

### Scenario C — Large organization

- 500–1,500 agents
- many departments and nested teams
- thousands of active tasks/runs
- high-volume schedules/events

### Scenario D — Incident / exception mode

- multiple failures at once
- stale authoritative inputs
- budget pressure
- approval queue growth
- repeated runtime failures

## Finding 1 — Navigation must scale by context, not by adding menu items

The current global information architecture remains valid, but the user cannot operate a 1,000-agent company by browsing flat lists.

Approved context hierarchy:

```text
Organization
  -> Program / Project
    -> Team / Department
      -> Goal / Task / Agent
        -> Run / Artifact / Decision / Event
```

The selected context must be visible persistently and encoded in deep links in the production React application.

### Decision UX-011-01

AOP uses hierarchical context narrowing. Large-scale UX must not solve complexity by adding more permanent navigation items.

## Finding 2 — Executive compression is mandatory

At scale, founders should not receive all activity. They should receive compressed exceptions and verified state.

The UI must prioritize:

1. Critical approvals
2. Critical blockers
3. Policy/security exceptions
4. Repeated failures / stalled work
5. Budget anomalies
6. Breaking authoritative changes
7. Milestone/critical-path risk

Normal successful work remains discoverable but is not promoted into the executive attention surface.

### Decision UX-011-02

The primary executive interaction unit is an **Attention Item**, not a raw event or message.

An Attention Item aggregates evidence and links to the underlying approval/task/artifact/event chain.

## Finding 3 — Attention ranking

AOP needs deterministic prioritization before any LLM-generated explanation.

Suggested ranking inputs:

```text
severity
+ blast radius
+ authority requirement
+ critical-path membership
+ age / SLA
+ repeated occurrence
+ budget impact
+ security/compliance impact
```

LLMs may summarize the ranked item, but they must not be the only mechanism deciding priority.

### Decision UX-011-03

Attention ordering must be reproducible from structured state. AI summarization may explain priority but not silently redefine it.

## Finding 4 — Command/search palette becomes primary navigation at scale

A persistent command palette should support:

- navigate to any organization/project/team/agent/task/artifact/decision/event
- filter by current context
- execute permitted quick actions
- create task/decision
- request review
- open approval inbox
- jump to blockers/critical path
- switch organization/project

Example queries:

```text
PHX-1402
Backend Agent
stale artifacts
blocked critical path
approvals high risk
events correlation corr_phx_auth
```

### Decision UX-011-04

Global Search evolves into a Search + Command Palette and is accessible from every screen.

## Finding 5 — Drill-down must preserve drill-up

A common failure in admin products is deep-linking into an object and losing the executive context that led there.

AOP detail pages therefore preserve a context trail.

Example:

```text
Acme Org
  / Project Phoenix
    / Critical Path
      / PHX-1402
        / API Spec v4
          / DEC-114
            / Event #10426
```

The user can jump upward without browser-history guessing.

### Decision UX-011-05

Every detail page exposes a stable breadcrumb/context trail plus explicit Relations.

## Finding 6 — Lists require saved views and density controls

For Tasks, Agents, Artifacts, Decisions, Schedules and Events, large-scale operation requires:

- filters
- grouping
- sorting
- search
- saved views
- compact/comfortable density
- scope selector
- export where appropriate
- bulk actions only when policies allow them

Suggested default saved views:

### Tasks

- My attention
- Critical path
- Blocked
- Review queue
- Stale inputs

### Agents

- Active now
- Overloaded
- Repeated failures
- Low reliability
- Permission exceptions

### Events

- High severity
- Current incident
- By correlation ID
- Policy/security events

### Decision UX-011-06

Kanban remains useful for project-scale work, but table/list/graph views are required for large-scale organizational operation.

## Finding 7 — Progressive disclosure

The prototype currently shows rich detail, which is useful for validation but can become dense.

Approved information layers:

### Layer 1 — Executive summary

- status
- verified impact
- owner
- risk
- next required action

### Layer 2 — Operational evidence

- dependencies
- artifacts
- decisions
- reviews
- permissions
- costs

### Layer 3 — Diagnostic detail

- events
- run history
- raw payload
- provider traces
- sandbox/tool diagnostics

### Decision UX-011-07

AOP keeps evidence available but does not present diagnostic data at the same visual priority as executive decisions.

## Finding 8 — Exception workflow

The preferred founder workflow is:

```text
Attention Center
  -> ranked exception
  -> executive summary
  -> evidence / blast radius
  -> related authoritative objects
  -> approve / reject / request changes / delegate
  -> resulting command/event
  -> verified state update
  -> return to Attention Center
```

### Decision UX-011-08

A human action is not finished when a button is clicked. The UI must show the resulting command/event and eventual verified state transition.

## Finding 9 — Scale simulation requirements

Before production implementation, the prototype must visually simulate at least:

- 12 agents
- 120 agents
- 1,200 agents

The information architecture should not change between these modes; only aggregation, filters and density should change.

### Decision UX-011-09

The React UI will later include seeded scale fixtures for UX/performance testing.

## Finding 10 — Performance budget

For the production observer UI:

- do not render thousands of rows without virtualization/pagination
- aggregate server-side where practical
- SSE updates should patch normalized cache rather than reload entire pages
- event feeds need cursoring and bounded live windows
- graphs need collapsed/clustered representations at large scale

### Decision UX-011-10

Scale UX and frontend performance are one design problem, not separate concerns.

## Prototype refinements authorized

Meeting #011 authorizes adding a non-invasive stress-review layer to the zero-build prototype:

1. hierarchical context switcher
2. command/search palette
3. executive Attention drawer with ranked exceptions
4. density/scale selector (10 / 100 / 1,000-agent mental model)
5. persistent drill-up breadcrumb cues
6. saved-view concepts on high-volume lists
7. keyboard-first navigation demonstration

These refinements must not change AOP domain truth or create new frontend-only lifecycle semantics.

## Final decisions

- UX-011-01 Hierarchical context narrowing is the scale model.
- UX-011-02 Attention Items are the executive exception unit.
- UX-011-03 Attention ranking is structured/deterministic before AI explanation.
- UX-011-04 Global search becomes Search + Command Palette.
- UX-011-05 Detail screens preserve drill-up context.
- UX-011-06 High-volume entities require saved list/table/graph views; kanban alone is insufficient.
- UX-011-07 Progressive disclosure separates executive, operational and diagnostic detail.
- UX-011-08 Human actions remain visible until their resulting state transition is verified.
- UX-011-09 Scale fixtures will test 12 / 120 / 1,200-agent modes.
- UX-011-10 Frontend performance is a UX requirement.

## Next gate

Meeting #012 should be the **UX Freeze & React Transfer Review**.

It should decide whether the information architecture, detail-shell, attention workflow, scale model and interaction patterns are stable enough to stop modifying the zero-build prototype and translate them into `apps/web` components/routes once the repository foundation exists.

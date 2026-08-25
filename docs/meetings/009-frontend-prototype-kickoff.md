# Founding Company Meeting #009 — Frontend Prototype Implementation Kickoff

Date: 2026-08-25

## Purpose

Start the first clickable AOP frontend prototype after UX/UI v0.1 approval. The prototype must validate navigation, information hierarchy, entity detail shells, and organization-state observability before full backend integration.

## Participants

- Founder representative
- CEO
- CPO
- UX Lead
- Product Designer
- CTO
- Frontend Lead
- Platform Architect
- QA Lead

## Decision summary

### UX-009-01 — Build a real clickable prototype now

The next step is implementation, not more speculative visual exploration.

The first vertical slice is:

```text
App Shell
  -> Executive Dashboard
  -> Project Workspace
  -> Task Detail
  -> Agent Detail
```

### UX-009-02 — Mock data is allowed, fake semantics are not

The prototype may use local fixtures while Query API/SSE are not available, but all fixture shapes must model future authoritative query responses. The frontend must not invent a second task lifecycle or organization truth model.

### UX-009-03 — Shared detail shell

Task, Agent, Artifact, Decision, Schedule, and Event pages use the same structural grammar:

- identity/status header
- lifecycle/important state
- main content
- contextual right rail
- discussion/activity
- evidence/relations
- bounded actions

### UX-009-04 — Navigation hierarchy

Primary navigation remains:

```text
Dashboard
Organizations
Projects
Tasks
Agents
Artifacts
Decisions
Schedule & Cron
Events
Knowledge & Memory
Reports
```

Marketplace navigation remains hidden in the PoC.

### UX-009-05 — Attention model

The app shell must have a persistent human-attention surface for:

- approvals
- critical blockers
- repeated run failures
- stale authoritative inputs
- permission requests
- budget/policy exceptions

### UX-009-06 — Prototype routes

The first prototype routes are:

```text
/dashboard
/orgs/demo/projects/phoenix
/orgs/demo/tasks/PHX-1402
/orgs/demo/agents/backend-agent
```

Additional routes can display placeholders while maintaining the full sidebar.

### UX-009-07 — Visual direction

The approved visual direction is dark enterprise control-center UI:

- deep navy/charcoal surfaces
- purple as primary accent
- semantic green/amber/red/blue states
- dense but scannable information architecture
- cards used for grouped state, not decorative fragmentation
- strong typography hierarchy
- data/status labels remain machine-readable and accessible

### UX-009-08 — Prototype acceptance

The prototype is acceptable when a user can:

1. understand current organization/project health from Dashboard,
2. enter Project Phoenix,
3. inspect project work and agent status,
4. open Task PHX-1402 and understand objective, state, dependencies, evidence, current run, blockers, reviews, and discussion,
5. open Backend Agent and understand identity, role, capabilities, current work, tools, memory classes, permissions, and performance,
6. navigate between these screens without losing organization/project context.

## Engineering rule

The prototype should be a thin observer/control client over future AOP Query API semantics. Components should be designed so mock repositories can later be replaced by HTTP/SSE adapters without rewriting page structure.

## Next implementation step

Create the initial frontend prototype skeleton under `prototype/` or `apps/web/` depending on repository implementation state, with shared navigation, fixture data, reusable detail-shell components, and the four approved routes.

# Founding Company Meeting #012 — UX Freeze & React Transfer Review

Date: 2026-08-25
Status: UX v0.1 FROZEN for PoC implementation

## Purpose

Decide whether the AOP information architecture, interaction model, executive Attention workflow, detail-shell, scale model, and operational semantics are stable enough to stop expanding the zero-build prototype and transfer the approved design into the production React + Vite `apps/web` implementation.

## Participants

- Founder representative
- Chief of Staff
- CEO
- CPO
- UX Lead
- Product Designer
- CTO
- Platform Architect
- Frontend Architect
- Agent Systems Architect
- Data/Query API Lead
- Security/Governance Lead
- SRE/Observability Lead
- QA/Evaluation Lead

## Review evidence

The team reviewed the progression:

- Meeting #008 — global UX/UI information architecture
- Meeting #009 — first clickable vertical slice
- Meeting #010 — truth, automation and human-control surfaces
- Meeting #011 — scale/navigation stress review for 12 / 120 / 1,200-agent mental models

No remaining issue requires another top-level navigation model or a new core product metaphor.

## Freeze decision

### Decision UX-012-01

**AOP UX v0.1 is frozen for PoC implementation.**

Freeze means production implementation must preserve the approved semantics unless real implementation evidence demonstrates that a change is required.

Freeze does not mean pixel-perfect styling is immutable.

## What is frozen

### 1. Product mental model

AOP is an **AI Organization Operating System**.

The UI is organized around:

- Executive state / Attention
- Work
- Workforce
- Truth / Control / Automation / Audit
- Knowledge / Memory

### 2. Core navigation model

```text
Dashboard
Project Workspace
Tasks
Agents
Artifacts
Decisions
Approvals
Schedule & Cron
Events
Knowledge & Memory
```

Large scale is handled by context narrowing, aggregation, saved views and command search rather than menu explosion.

### 3. Context hierarchy

```text
Organization
  -> Project / Program
    -> Team / Department
      -> Entity
        -> Run / Version / Event
```

### 4. Shared detail shell

Every authoritative detail screen follows the same conceptual grammar:

```text
Identity / status / primary action
Lifecycle / authoritative metadata
Main evidence / relations      Context rail
Discussion / activity          Owner / authority
Events / diagnostics           Risks / approvals
```

### 5. Attention model

The executive control loop is:

```text
Attention
  -> Exception
  -> Evidence / blast radius
  -> Related truth
  -> Human action
  -> Command / Event
  -> Verified state transition
  -> Attention resolved
```

Attention priority comes from structured state before AI summarization.

### 6. Truth semantics

- messages are not authoritative truth
- artifacts are immutable/versioned authoritative outputs
- decisions are explicit authoritative objects
- approvals are durable workflows
- events are immutable audit records
- memory is not organizational truth
- verified completion derives from Kernel state/evidence

### 7. Scale model

The same information architecture must operate at small/growing/large organization sizes.

Production high-volume views require:

- server-side filters/aggregation
- pagination/cursors
- virtualization where needed
- saved views
- compact/dense modes
- graph clustering/collapse

### 8. Search + Command Palette

Global search is also a command/navigation palette and must be available from every authenticated application view.

### 9. Drill-down / drill-up

No authoritative object may become a dead-end detail page. Relations, Events and stable context/breadcrumbs are required.

## What is NOT frozen

The following may evolve during implementation without reopening UX architecture review:

- exact color values
- exact shadows/radii
- typography implementation
- chart library
- icon library
- spacing refinements
- responsive breakpoints
- exact table component
- graph rendering library
- animation/motion polish
- final component library choice

Changes still must preserve accessibility and semantic status meaning.

## Production component architecture

The Frontend Architect proposes the following reusable boundaries.

### Application / navigation

```text
AppShell
GlobalSidebar
TopBar
ContextSwitcher
BreadcrumbTrail
CommandPalette
AttentionButton
AttentionDrawer
Scale/DensityControls (dev/test fixture + user density preference)
```

### Common entity primitives

```text
EntityHeader
StatusBadge
SeverityBadge
AuthorityBadge
VersionBadge
VerifiedProgress
LifecycleStepper
DetailShell
ContextRail
RelationsPanel
EventTimeline
EvidenceList
ApprovalSummary
SavedViewBar
FilterBar
DataTable
VirtualizedList
```

### Domain modules

```text
DashboardModule
ProjectModule
TaskModule
AgentModule
ArtifactModule
DecisionModule
ApprovalModule
ScheduleModule
EventModule
KnowledgeModule
```

Domain modules compose shared primitives and consume typed Query API projections. They do not own independent authoritative lifecycle state.

## Route policy

Canonical production routes remain organization-scoped.

Examples:

```text
/orgs/:orgId/dashboard
/orgs/:orgId/projects/:projectId
/orgs/:orgId/tasks/:taskId
/orgs/:orgId/agents/:agentId
/orgs/:orgId/artifacts/:artifactId
/orgs/:orgId/decisions/:decisionId
/orgs/:orgId/approvals/:approvalId
/orgs/:orgId/schedules/:scheduleId
/orgs/:orgId/events/:eventId
```

Project/team context may be represented by nested routes or filters, but organization tenancy is always explicit.

## Data ownership rule

### Decision UX-012-02

The React application is an observer/control client, never a second authoritative state machine.

Frontend state may contain:

- route/context selection
- filters/sorts/saved-view configuration
- UI expansion state
- form drafts
- query cache
- temporary command progress

Frontend state must not invent:

- Task lifecycle status
- Decision authority
- Artifact current version
- Approval result
- Agent permission
- Verified completion
- Lease ownership

Those are Kernel/Query API concerns.

## Query API projections required by UX

The frontend expects backend projections for at least:

### Executive

- organization health snapshot
- ranked Attention Items
- project/goal verified progress
- blockers/critical path
- budget/usage summary

### Task

- work contract
- lifecycle
- dependencies
- exact authoritative inputs/outputs
- current run/lease
- review/evidence
- approvals
- relations/events

### Agent

- organizational identity/membership
- role/authority
- capabilities
- work queue/load
- tool/capability grants
- performance projections
- memory references by class

### Artifact

- logical identity
- immutable versions
- current approved version
- provenance
- lineage
- consumers/stale consumers
- related decisions/events

### Decision

- state
- question/options/rationale
- authority
- impact
- affected objects
- events

### Approval

- requested command
- policy reason
- requester/authority
- evidence/risk/blast radius
- result/history

### Schedule

- human-readable recurrence
- timezone
- raw rule/cron
- owner
- next/previous run
- health/run history
- linked resources/events

### Events

- ordered sequence
- normalized event fields
- correlation/causation
- relations
- raw payload access

## SSE/realtime contract

### Decision UX-012-03

Realtime UI follows **Snapshot + Ordered SSE + Reconciliation**.

Expected sequence:

```text
1. Fetch organization/page snapshot
2. Record latest organization sequence
3. Connect SSE after that sequence
4. Apply ordered events to query/cache invalidation or normalized projections
5. On disconnect, visibly enter RECONNECTING/STALE mode
6. Resume from known sequence
7. If resume gap cannot be guaranteed, refetch authoritative snapshot
```

The UI must never silently claim live correctness after losing ordering guarantees.

## Command/mutation UX

### Decision UX-012-04

Do not use optimistic authoritative lifecycle changes for protected or consequential mutations.

For example, after the user clicks Approve:

```text
Local form action
  -> command submitted
  -> Pending command UI
  -> Kernel ALLOW/DENY/REQUIRE_APPROVAL/result
  -> Event/query reconciliation
  -> authoritative state shown
```

Safe optimistic UI may be used for non-authoritative preferences such as filters, expanded panels, local drafts or density preference.

## Error/conflict UX

Production UI needs explicit states for:

- REVISION_CONFLICT
- PERMISSION_DENIED
- APPROVAL_REQUIRED
- STALE_INPUT
- LEASE_LOST / RUN_LOST
- CONTEXT_STALE
- SSE_RECONNECTING
- QUERY_STALE
- COMMAND_TIMEOUT / UNKNOWN_OUTCOME

Unknown outcome must never be rendered as success.

## Accessibility freeze

### Decision UX-012-05

Accessibility is part of the frozen UX contract.

Required baseline:

- keyboard navigation
- visible focus
- semantic labels
- status not represented by color alone
- readable contrast
- command palette keyboard operation
- screen-reader meaningful entity/action labels
- reduced-motion compatibility where motion is added

## React transfer order

Approved transfer sequence:

```text
R0 App shell + design tokens
R1 Router + organization context + breadcrumbs
R2 Query client + Snapshot/SSE/reconnect infrastructure
R3 Shared entity/detail primitives
R4 Command Palette + Attention Center
R5 Dashboard + Project Workspace
R6 Task + Agent
R7 Artifact + Decision + Approval
R8 Schedule + Events
R9 Knowledge/Memory
R10 Scale/performance/accessibility/E2E hardening
```

The production UI may be developed in parallel with backend slices only when required Query API projections exist or stable mocked contracts are generated from protocol schemas.

## Prototype disposition

The zero-build prototype remains in `prototype/` as:

- interaction reference
- product review artifact
- E2E scenario reference
- visual/semantic comparison during React transfer

It is not production code and should not accumulate additional business logic after this meeting unless a validated UX defect requires a prototype experiment.

## UX change-control after freeze

A frozen UX decision may change only when one of the following exists:

1. implementation evidence shows the design is infeasible or misleading,
2. usability testing demonstrates a material failure,
3. protocol/domain semantics change,
4. accessibility/security requirements demand change,
5. scale/performance evidence invalidates the current interaction.

Cross-cutting changes require an ADR or a new design decision record rather than silent frontend drift.

## Final decisions

- UX-012-01 UX v0.1 is frozen for PoC implementation.
- UX-012-02 React is an observer/control client, not authoritative state.
- UX-012-03 Realtime contract is Snapshot + Ordered SSE + Reconciliation.
- UX-012-04 Consequential mutations wait for authoritative command/event reconciliation.
- UX-012-05 Accessibility is part of the frozen contract.
- UX-012-06 The zero-build prototype stops feature expansion after this review.
- UX-012-07 React transfer begins only through the approved component/data boundaries.

## Outcome

The UX design phase is complete enough to implement.

The next work should return to the engineering execution plan beginning with repository foundation / Slice 0. Frontend production work starts when the monorepo and protocol/query boundaries are ready.

# AOP React Transfer Plan

Date: 2026-08-25
Status: Approved after Meeting #012
Source UX: `docs/design/UX_UI_SYSTEM_v0.1.md`
Prototype reference: `prototype/`

## Objective

Transfer the approved zero-build AOP interaction model into the production `apps/web` React + Vite application without turning frontend state into a second source of organizational truth.

## Preconditions

Production transfer starts when the repository foundation exists and the relevant protocol/query contracts can be imported or generated.

Minimum preconditions:

- monorepo initialized
- shared TypeScript config
- `packages/protocol` exists
- frontend build/test/lint works
- Query API contract location agreed
- organization tenancy/context model available

## Architecture boundary

```text
AOP Kernel / Query API / SSE
          |
          v
Typed frontend data layer
          |
          v
React observer/control UI
```

The browser may cache and present authoritative state, but does not define it.

## Phase R0 — App Shell & Design Foundation

Deliverables:

- `apps/web`
- Vite + React + TypeScript baseline
- application theme/tokens
- semantic color/status tokens
- AppShell
- GlobalSidebar
- TopBar
- ErrorBoundary
- Loading/Empty/Error primitives
- responsive desktop-first shell

Acceptance:

- deep route renders inside shell
- no prototype global CSS dependency required
- status meaning is semantic, not color-only
- keyboard focus baseline visible

## Phase R1 — Routing & Operating Context

Deliverables:

- canonical org-scoped routes
- OrganizationContext
- Project/Team narrowing
- ContextSwitcher
- BreadcrumbTrail
- route-to-context synchronization
- not-found / unauthorized routes

Canonical pattern:

```text
/orgs/:orgId/...
```

Acceptance:

- organization context is unambiguous on every protected route
- browser refresh preserves context
- detail page always has drill-up path

## Phase R2 — Query / Cache / Realtime Foundation

Deliverables:

- typed Query API client
- query/cache client setup
- organization snapshot bootstrap
- SSE client
- `lastSequence` tracking
- reconnect state
- stale state indicator
- reconciliation/refetch rules
- normalized command error mapping

Acceptance:

- snapshot + SSE converges after reconnect
- duplicate/out-of-order events do not create duplicate UI entries
- ordering uncertainty triggers visible stale/reconnect behavior

## Phase R3 — Shared Entity Primitives

Deliverables:

- EntityHeader
- DetailShell
- ContextRail
- RelationsPanel
- EventTimeline
- EvidenceList
- LifecycleStepper
- VerifiedProgress
- StatusBadge
- SeverityBadge
- AuthorityBadge
- VersionBadge
- SavedViewBar
- FilterBar
- DataTable
- VirtualizedList boundary

Acceptance:

- Task/Agent/Artifact/Decision/Schedule/Event detail screens can share layout grammar
- compact/comfortable density supported
- semantic states have text/icon meaning

## Phase R4 — Command Palette & Attention Center

Deliverables:

- Cmd/Ctrl+K palette
- cross-object search result types
- navigation commands
- permitted quick-action command boundary
- ranked Attention Items
- Attention drawer/inbox
- attention filters
- deep links to underlying evidence/objects

Attention Item contract should contain enough structured data to explain:

```text
why now?
why important?
who owns it?
what is blocked/at risk?
what human action is required?
what evidence exists?
```

Acceptance:

- founder can reach a critical object without browsing lists
- attention ranking does not rely solely on LLM output

## Phase R5 — Dashboard & Project Workspace

Deliverables:

- Executive Dashboard
- verified health/progress
- critical risks/blockers
- approval summary
- truth changes
- Project Workspace
- project task board/list
- critical path summary
- project agents/artifacts/decisions
- collaboration entry points

Acceptance:

- important exceptions render before low-value analytics
- verified progress always links to underlying work/evidence

## Phase R6 — Task & Agent Modules

### Task

- task board/list/saved views
- Task Detail
- dependencies
- authoritative inputs/outputs
- run/lease
- evidence/review
- blockers
- related decisions/approvals/events

### Agent

- directory/table
- Agent Detail
- organizational role/membership
- capability
- work queue/load
- memory classes
- tool grants
- performance
- permission matrix

Acceptance:

- Task completion is not client-derived
- Agent runtime status is not confused with employment/membership
- memory is visually distinct from authoritative truth

## Phase R7 — Artifact / Decision / Approval

### Artifact

- Registry
- exact versions
- current approved version
- provenance
- lineage
- consumers/stale consumers
- impact

### Decision

- Registry
- question/options/rationale
- authority
- state
- downstream impact

### Approval

- ranked inbox
- exact requested command
- policy reason
- evidence/risk/blast radius
- Approve/Reject/Request Changes
- command progress/outcome

Acceptance:

- no conversational conclusion silently changes truth
- approval click waits for authoritative result/reconciliation

## Phase R8 — Schedule & Events

### Schedule

- calendar/list
- human-readable recurrence
- timezone
- raw cron/rule
- run history
- health/missed runs
- linked resources

### Events

- cursor-based Event Explorer
- severity/type/actor/context filters
- correlation/causation
- Event Detail
- raw payload
- deep relation links

Acceptance:

- schedule failures link to runs/events
- Activity / Event / Trace terminology remains distinct

## Phase R9 — Knowledge & Memory

Deliverables:

- memory class explorer
- provenance/source
- working/project/agent memory distinction
- organization knowledge references
- promotion/evidence boundary
- links to authoritative artifacts/decisions

Acceptance:

- retrieved memory is never presented as organizational truth without promotion/evidence

## Phase R10 — Scale, Performance, Accessibility & E2E

### Scale fixtures

Seed UI test environments for:

- ~12 agents
- ~120 agents
- ~1,200 agents

### Performance requirements

- cursor pagination for high-volume lists
- virtualized rendering when dataset warrants it
- bounded live event window
- server aggregation for dashboards
- graph clustering/collapse at scale
- avoid full-page refetch for each SSE event

### Accessibility

- keyboard navigation
- visible focus
- labels/roles
- contrast
- status meaning beyond color
- command palette fully keyboard usable
- reduced motion support

### Required E2E workflows

1. Dashboard -> Attention -> Approval -> Task -> Artifact -> Decision -> Event.
2. Cmd/Ctrl+K -> PHX task -> drill-up Project -> Dashboard.
3. Task changes via ordered SSE.
4. SSE disconnect -> reconnect -> resume/reconcile.
5. Artifact breaking version -> stale consumer visible.
6. Revision conflict -> frontend returns to authoritative state.
7. Approval command pending -> accepted/rejected -> event -> updated state.
8. Permission denial never leaves false optimistic state.
9. Schedule failure -> Event -> related run/resource.
10. 1,200-agent fixture remains navigable without rendering all rows at once.

## Command mutation state model

Frontend mutation state is separate from domain state.

Suggested local command UI state:

```text
IDLE
  -> SUBMITTING
  -> ACCEPTED / REJECTED / APPROVAL_REQUIRED / UNKNOWN
  -> RECONCILING
  -> SETTLED
```

This does not replace Task/Decision/Approval lifecycle states.

## Query keys / cache boundaries

The exact library is implementation-selected, but cache keys should preserve tenancy and entity identity.

Examples:

```text
org/:orgId/snapshot
org/:orgId/attention
org/:orgId/project/:projectId
org/:orgId/task/:taskId
org/:orgId/agent/:agentId
org/:orgId/artifact/:artifactId
org/:orgId/decision/:decisionId
org/:orgId/approval/:approvalId
org/:orgId/schedule/:scheduleId
org/:orgId/events?cursor=...
```

SSE consumers invalidate or patch these known projections rather than constructing new authority client-side.

## Component ownership rule

A domain page may own presentation composition but must not duplicate shared interaction semantics.

Examples:

- all detail pages use `DetailShell`
- all status pills use semantic badge primitives
- all event links use shared event relation UI
- all protected command outcomes use shared command feedback
- all high-volume lists use shared saved-view/filter/density primitives

## Prototype-to-production mapping

| Prototype concept | React production component |
|---|---|
| sidebar/topbar | `AppShell`, `GlobalSidebar`, `TopBar` |
| top context switch | `ContextSwitcher` |
| breadcrumb/drill-up | `BreadcrumbTrail` |
| Cmd/Ctrl+K overlay | `CommandPalette` |
| Attention drawer | `AttentionCenter` / `AttentionDrawer` |
| KPI/card shell | `MetricCard`, dashboard compositions |
| detail page layout | `DetailShell` + `ContextRail` |
| task lifecycle | `LifecycleStepper` |
| artifact lineage | `ArtifactLineageGraph` |
| relation chain | `RelationsPanel` |
| event list | `EventTable` / `EventTimeline` |
| schedule calendar | `ScheduleCalendar` / `ScheduleList` |
| scale fixture bar | development fixtures + `SavedViewBar` / density controls |

## Exit gate

React transfer is considered successful when the production UI can reproduce the prototype's primary operating loop using real typed projections:

```text
Attention
 -> Approval
 -> Task
 -> Agent / Artifact / Decision
 -> Event
 -> verified organization state
```

and the browser remains an observer/control surface rather than a source of organizational truth.

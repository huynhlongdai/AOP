# AOP UI Implementation Plan

Date: 2026-08-25
Status: Approved after Meeting #008
Depends on: Query API, ordered SSE organization stream, core domain state
Design source: `docs/design/UX_UI_SYSTEM_v0.1.md`

## Goal

Build a coherent observer/control interface over the AOP Organization Kernel without creating a second frontend source of truth.

## Technical baseline

- React + Vite
- TypeScript
- shared component/design-system layer
- query/cache client for Query API
- SSE organization stream client
- router with deep-linkable organization/project/entity routes
- graph visualization for org/task/lineage graphs
- browser E2E tests
- accessible component primitives

Exact packages are selected during implementation and pinned in the lockfile.

## Route model

```text
/
/dashboard

/orgs
/orgs/:orgId
/orgs/:orgId/org-chart

/orgs/:orgId/projects
/orgs/:orgId/projects/:projectId

/orgs/:orgId/tasks
/orgs/:orgId/tasks/:taskId

/orgs/:orgId/agents
/orgs/:orgId/agents/:agentId

/orgs/:orgId/artifacts
/orgs/:orgId/artifacts/:artifactId

/orgs/:orgId/decisions
/orgs/:orgId/decisions/:decisionId

/orgs/:orgId/approvals

/orgs/:orgId/schedules
/orgs/:orgId/schedules/:scheduleId

/orgs/:orgId/events
/orgs/:orgId/events/:eventId

/orgs/:orgId/knowledge
/orgs/:orgId/reports
```

Project context may be represented by query/filter or nested route where appropriate, but organization ID remains the primary tenancy/context boundary.

## UI-00 — Application shell

Deliverables:

- AppShell
- Sidebar
- TopBar
- Organization/Project ContextSwitcher
- global search placeholder/interface
- notification/attention entry
- responsive shell
- route guards/loading/error boundaries

Acceptance:

- navigation state persists across deep links
- organization context is never ambiguous
- mobile collapses sidebar correctly

Dependencies: frontend repository foundation.

---

## UI-01 — Design primitives

Deliverables:

- typography/tokens
- spacing/radius/elevation
- dark theme baseline
- semantic status palette
- StatusBadge
- SeverityBadge
- VersionBadge
- AuthorityBadge
- MetricCard
- Progress/VerifiedProgress
- LifecycleStepper
- Tabs
- ContextRail
- Empty/Error/Loading/Reconnecting states

Acceptance:

- semantic state does not rely on color alone
- components work at comfortable/compact densities
- keyboard focus is visible

Dependencies: UI-00.

---

## UI-02 — Query + realtime data layer

Deliverables:

- typed Query API client
- organization snapshot bootstrap
- ordered SSE stream client
- reconnect cursor/sequence support
- invalidation/reconciliation rules
- stale/reconnecting indicator
- permission-aware command client boundary

Acceptance:

- disconnect/reconnect does not create duplicate visible events
- snapshot + resumed SSE converges to server truth
- page does not use client-only derived authoritative state

Dependencies: Query API/SSE backend.

---

## UI-03 — Executive Dashboard

Deliverables:

- primary KPI row
- organization health
- project health
- agent utilization
- task throughput
- decision cycle metric
- approvals panel
- risks/blockers
- critical alerts/events
- milestones

Acceptance:

- attention items appear before secondary analytics
- verified progress links to underlying evidence/work
- no fake/sample state in production path

Dependencies: UI-01, UI-02.

---

## UI-04 — Organization Overview + Org Chart

Deliverables:

- organization identity/mission/status
- executive summary
- role/agent hierarchy graph
- team summaries
- authority/manager links
- active goals/projects
- organization health and risks

Acceptance:

- clicking node opens Agent/Role context
- hierarchy reflects authoritative role assignments

Dependencies: UI-01, UI-02.

---

## UI-05 — Task Board/List

Deliverables:

- Board: Backlog/Ready/In Progress/Review/Done
- List view
- filters
- task cards
- blocked flags/filter
- critical-path/dependency indicators
- realtime task state movement

Acceptance:

- blocked is a state/filter, not incorrectly persisted as a fake lifecycle column
- board reconciles after command failure/revision conflict

Dependencies: UI-01, UI-02.

---

## UI-06 — Task Detail

Deliverables:

- EntityHeader
- lifecycle strip
- overview modules
- acceptance criteria
- dependencies
- exact artifact inputs/outputs
- current Run and history
- Lease
- budget/usage
- subtasks
- decisions
- blockers
- reviews/approvals
- discussion entry point
- event/activity timeline

Acceptance:

- user can identify source truth versions and blocker reason without raw logs
- completed status is clearly verified
- stale input state is visually explicit

Dependencies: UI-05 plus artifact/decision/review queries.

---

## UI-07 — Agent Directory

Deliverables:

- workforce table
- role/status/provider/capability filters
- availability/workload
- performance/cost
- current assignment

Acceptance:

- agent runtime presence is not confused with employment status
- capability/performance data has clear provenance where available

Dependencies: UI-01, UI-02.

---

## UI-08 — Agent Detail

Deliverables:

- Overview
- Capabilities
- Memory
- Tools
- Work
- Activity
- Performance
- Permissions

Acceptance:

- memory is visually differentiated from authoritative truth
- permissions show allowed/denied/approval-required
- active/queued assignments link to tasks/runs

Dependencies: UI-07.

---

## UI-09 — Artifact Registry + Detail

Deliverables:

- registry/list
- version/status filters
- exact version labels
- stale/superseded/breaking indicators
- Artifact Detail
- versions
- lineage graph
- consumers
- producer task/agent
- preview/raw view

Acceptance:

- current approved version is unmistakable
- lineage/consumer links navigate to related entities

Dependencies: UI-02 and Artifact Registry backend.

---

## UI-10 — Decision Registry + Detail

Deliverables:

- Needs Decision
- Approval Pending
- Active
- Superseded
- Rejected
- Decision Detail with question/options/rationale/authority/impact

Acceptance:

- active authoritative decision is visually distinct from discussion/proposal
- approval command respects Policy Engine response

Dependencies: UI-02 and Decision backend.

---

## UI-11 — Approval Inbox / Attention Center

Deliverables:

- approval request list
- risk/impact/evidence context
- linked task/decision/command entities
- approve/reject actions
- pending/completed history

Acceptance:

- user can make normal approval decision without reading complete chat history
- approval action handles REQUIRE_APPROVAL/denied/revision conflict states safely

Dependencies: command/approval API.

---

## UI-12 — Events + Event Detail

Deliverables:

- Live Events
- Audit Log
- Alerts
- System Events
- filters
- ordered event rows
- Event Detail/context rail
- correlation/causation/sequence fields
- raw payload

Acceptance:

- activity/event/trace terminology remains distinct
- reconnect/resume ordering is correct

Dependencies: UI-02.

---

## UI-13 — Schedule & Cron

Deliverables:

- health summary
- month/week/day/agenda calendar
- upcoming queue
- missed runs
- schedule list
- Schedule Detail
- run history
- run now/pause/resume commands
- human-readable cron/timezone

Acceptance:

- every cron has human-readable recurrence and timezone
- missed/failed scheduled executions link to runs/events

Dependencies: schedule domain/API availability.

---

## UI-14 — Project Workspace

Deliverables:

- workspace summary
- project progress/critical path
- embedded task board
- agent panel
- artifacts
- decisions
- risks/blockers
- collaboration/timeline tabs

Acceptance:

- workspace composes authoritative projections and does not create duplicate project state

Dependencies: UI-03 through UI-10.

---

## UI-15 — Collaboration surface

Deliverables:

- project/team channels
- DMs
- entity references
- threads
- pinned objects
- structured actions from messages

Acceptance:

- discussion may create proposals/commands but cannot silently mutate authoritative objects
- links to tasks/artifacts/decisions remain stable

Dependencies: messaging domain plus core entity UIs.

---

## UI-16 — Knowledge & Memory explorer

Deliverables:

- working/project/episodic/semantic memory grouping
- search/filter
- source/provenance
- links to authoritative artifacts/decisions
- memory lifecycle/retention indicators where supported

Acceptance:

- interface never labels retrieved memory as organization truth

Dependencies: memory backend.

---

## UI-17 — QA/E2E/accessibility

Required E2E scenarios:

1. Founder opens Dashboard and follows a blocker to Task Detail.
2. Task transitions through running/review/completed over SSE.
3. Breaking artifact version marks dependent work stale.
4. Human receives and resolves approval request.
5. Agent Detail shows current assignment and bounded permissions.
6. SSE disconnect/reconnect resumes correctly.
7. Event correlation links Task → Run → Artifact/Decision.
8. Schedule failure links to Event/Run.
9. Permission-denied mutation does not leave optimistic UI in false state.
10. keyboard navigation and focus baseline passes.

---

## Implementation order

```text
UI-00 Shell
  ↓
UI-01 Primitives
  ↓
UI-02 Data/realtime
  ↓
┌───────────┬───────────┬───────────┐
Dashboard   Tasks       Agents
UI-03       UI-05/06    UI-07/08
└─────┬───────────┬───────────┬─────┘
      ↓           ↓           ↓
Artifacts     Decisions    Events
UI-09         UI-10/11     UI-12
      └──────────┬───────────┘
                 ↓
         Project Workspace
               UI-14
                 ↓
      Schedule / Collaboration
          UI-13 / UI-15
                 ↓
       Knowledge + QA polish
          UI-16 / UI-17
```

Schedule UI may move earlier if its backend domain is available sooner.

## P0 implementation gate

P0 is complete when a Founder can:

1. select an organization/project,
2. understand verified organization/project health,
3. inspect an agent and its bounded authority,
4. inspect task truth/run/blockers/evidence,
5. inspect artifact versions and decisions,
6. observe ordered events,
7. resolve approvals,
8. inspect schedules,
9. navigate related objects without losing context,
10. receive live updates and recover from disconnect.

## Non-goals for P0

- marketplace browsing/purchase
- agent reputation economy
- public profiles
- advanced theme customization
- full mobile dense workspace
- visual workflow builder
- arbitrary dashboard builder

## UX engineering rule

If a proposed frontend feature requires inventing authoritative state that the Query API/Protocol does not expose, stop and change the backend projection/protocol rather than implementing client-side truth.

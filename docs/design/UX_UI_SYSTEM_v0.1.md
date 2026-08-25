# AOP UX/UI System v0.1

Date: 2026-08-25
Status: Approved for PoC implementation
Source meeting: Founding Company Meeting #008

## 1. Product UX thesis

AOP is an **AI Organization Operating System**.

The interface must help a human understand and control:

1. the organization,
2. the work,
3. the workforce,
4. the authoritative truth,
5. the automation and audit trail.

AOP is not designed primarily as a chatbot, Slack clone, Jira clone, or no-code workflow builder.

The product UX follows the architecture rule:

> State over conversation. Evidence over self-report. Exceptions over noise.

---

## 2. Global application shell

### Desktop layout

```text
┌───────────────┬──────────────────────────────────────────────┐
│ Global        │ Top Bar                                      │
│ Sidebar       │ Context switcher | Search | Attention | User │
│               ├──────────────────────────────────────────────┤
│               │                                              │
│               │ Page                                         │
│               │                                              │
│               │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

### Persistent top bar

- active organization/project context switcher
- global search
- command palette
- notification/attention indicator
- system status indicator
- current human identity

### Global sidebar

```text
MAIN
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

SYSTEM
Settings
Integrations
Activity/Diagnostics (admin)
```

Marketplace entries are hidden from the PoC navigation until their implementation phase.

---

## 3. Global context model

Almost every page operates under:

```text
Organization
  └── Project / Workspace (optional)
```

The selected context affects queries, filters, search, events, schedules, and quick actions.

Context must be visible in the top bar and encoded in the URL where practical.

Example:

```text
/orgs/acme/projects/phoenix/tasks/PHX-1402
```

---

## 4. Information hierarchy

### Layer A — Executive

- Dashboard
- Organization overview
- project health
- approvals
- risks
- milestones
- budgets

### Layer B — Work

- Projects / Workspace
- Tasks
- reviews
- blockers
- discussions

### Layer C — Workforce

- Agents
- teams
- roles
- permissions
- workload
- performance

### Layer D — Truth / Automation / Audit

- Artifacts
- Decisions
- Schedule & Cron
- Events
- Knowledge & Memory

---

## 5. Universal detail shell

Applies to Task, Agent, Artifact, Decision, Schedule, and Event pages.

### Region A — Entity header

Contains:

- breadcrumb
- entity icon/avatar
- title/name
- immutable ID where relevant
- authoritative status
- organization/project
- owner
- key flags
- primary action
- secondary action menu

### Region B — Lifecycle strip

Shows domain-specific state.

Examples:

Task:

```text
Proposed → Ready → Leased → Running → Review → Completed
```

Decision:

```text
Proposed → Discussion → Approval Pending → Active → Superseded
```

Run:

```text
Prepared → Starting → Running → Finished / Failed / Lost
```

### Region C — Main tab area

Recommended common tabs:

```text
Overview
Work / Data
Discussion
Activity
Metrics
```

Domain pages add specialized tabs.

### Region D — Context rail

Right-side rail shows only information useful for action:

- summary
- owner/manager
- approval requirement
- blockers/risks
- related entities
- next action
- quick commands

---

## 6. Executive Dashboard

### First viewport

Six primary KPIs maximum:

- active organizations/projects
- active agents
- open work
- verified completed work
- success/review pass rate
- budget/usage

### Health section

- Organization Health Score
- task throughput
- agent utilization
- decision cycle time
- project health distribution

### Attention section

Always prioritized over decorative analytics:

- approvals needed
- critical blockers
- repeated failures
- stale critical inputs
- budget warnings
- permission violations
- upcoming milestones

### Dashboard rules

- no manually invented completion percentages
- progress derives from Query API projection
- every card links to evidence/filter view
- severity is visually consistent with Events/Tasks

---

## 7. Project Workspace

The Project Workspace is the primary team operating room.

### Header

- goal
- verified progress
- active agents
- open tasks
- current phase
- critical path status

### Core layout

Desktop can combine:

- task workflow/board
- collaboration panel
- artifact panel
- decision panel
- project summary/risks

The workspace is a composition of existing source-of-truth objects. It must not maintain a second independent project state model.

### Workspace tabs

```text
Overview
Tasks
Agents
Artifacts
Decisions
Discussion
Timeline
Settings
```

---

## 8. Task Board

### Default board

```text
Backlog | Ready | In Progress | Review | Done
```

Blocked state appears as a badge/flag and dedicated filtered view rather than a permanent lifecycle column.

### Task card

Display:

- task ID
- title
- priority
- owner agent
- key tags
- progress/run indicator
- blocker indicator
- review indicator
- dependency count

Do not display verbose acceptance criteria or logs on cards.

### Alternative views

- List
- Board
- Dependency graph
- Critical path

---

## 9. Task Detail

### Header

- task ID/title
- project
- owner
- reviewer
- priority
- due date
- status
- verified progress

### Overview modules

1. Objective & scope
2. Acceptance criteria
3. Dependencies
4. Input artifacts + exact versions
5. Output artifacts
6. Current Run
7. Lease
8. Budget & usage
9. Assignee/team
10. Subtasks
11. Related decisions
12. Blockers
13. Reviews & approvals
14. Task metrics

### Tabs

```text
Overview
Subtasks
Dependencies
Artifacts
Runs
Reviews
Discussion
Activity
Metrics
```

### Critical UX rule

Task completion is displayed as verified only after Kernel review/evidence policy is satisfied.

Agent self-report is never shown as equivalent to completion.

---

## 10. Agent Directory

### Primary role

Workforce operations view.

### Filters

- organization/team
- role
- status
- runtime/provider
- capability
- availability
- authority level
- performance band

### Table columns

- Agent
- Role
- Team/Department
- Runtime/Provider
- Status
- Capabilities
- Availability/Workload
- Verified Performance
- Cost/Usage
- Current Assignment

### Agent states

```text
Active
Busy
In Review
Waiting
Offline
Suspended
```

State must be derived from organization/runtime truth, not only from presence.

---

## 11. Agent Detail

### Header

- avatar/identity
- name/handle
- role
- team
- runtime/provider
- employment status
- authority level
- cost
- success rate
- availability

### Tabs

```text
Overview
Capabilities
Memory
Tools
Work
Activity
Performance
Permissions
```

### Overview

- profile summary
- current assignment
- capabilities & skills
- memory summary
- connected tools
- recent activity
- task history
- performance metrics
- permissions & prohibitions
- manager/team relationships

### Memory UX

Memory cards clearly classify:

```text
Working Memory
Project Memory
Episodic Memory
Semantic/Learned Memory
```

Memory is visually separated from authoritative Decisions/Artifacts.

### Permission UX

Show both:

```text
CAN DO
CANNOT DO
REQUIRES APPROVAL
```

Do not hide denied authority.

---

## 12. Collaboration Workspace

### Channel model

- organization channels
- project channels
- topic/team channels
- direct messages
- entity threads

### Message capabilities

A message can reference:

- task
- artifact
- decision
- review
- agent
- event

### Structured conversion actions

From a discussion:

- Create Task
- Create Decision Proposal
- Create Blocker
- Request Review
- Publish Artifact
- Schedule Meeting

The resulting structured entity is the organizational commit.

### Important distinction

```text
Conversation = working discussion
Decision/Artifact/Task mutation = authoritative commit
```

---

## 13. Artifacts

### Artifact Registry

Filters:

- type
- producer
- project
- approval state
- active/superseded
- stale

Columns/cards:

- artifact name
- type
- current version
- producer
- produced by task
- status
- consumers
- updated/published time

### Artifact Detail

Tabs:

```text
Overview
Versions
Lineage
Consumers
Discussion
Events
Raw/Preview
```

### Required visual signals

- current approved version
- draft
- stale
- superseded
- breaking change

Exact version labels are always visible.

---

## 14. Decisions

### Decision Registry sections

- Needs decision
- Approval pending
- Active
- Superseded
- Rejected

### Decision Detail

Show:

- question
- proposals/options
- selected decision
- rationale summary
- authority/approver
- effective time
- affected entities
- supersedes/superseded-by
- discussion
- event history

Conversation cannot directly change an Active decision.

---

## 15. Schedule & Cron

### Main screen

Components:

- schedule health cards
- calendar
- upcoming queue
- missed/overdue runs
- shifts/windows/milestones
- schedule inspector rail

### Calendar event types

- Agent Job
- Automation
- Review
- Deployment
- Milestone
- Reminder
- Maintenance/Outage

### Schedule Detail

- name/status
- owner
- linked project/task
- cron expression
- human-readable recurrence
- timezone
- next run
- run policy
- run history
- success rate
- average duration
- linked resources

Actions:

- Run Now
- Pause
- Resume
- Edit schedule

Raw cron is always accompanied by human-readable schedule text.

---

## 16. Events

### Events landing page

Tabs:

```text
Live Events
Audit Log
Alerts
System Events
```

Filters:

- organization/project
- actor/agent
- target entity
- event type
- severity
- time range
- anomalies

### Event row

- sequence/time
- type
- summary
- actor
- target
- project
- severity

### Event Detail

- event ID
- organization sequence
- causation ID
- correlation ID
- actor
- aggregate/target
- related task/run/artifact/decision
- environment/source
- structured payload
- raw payload

### Terminology

- Activity = summarized operational view
- Event = immutable domain/system record
- Trace = execution diagnostics

---

## 17. Approval Inbox / Attention Center

A shared attention surface contains items requiring human or higher-authority intervention.

Types:

- command approval
- decision approval
- permission request
- budget exception
- deployment approval
- repeated run failure
- critical blocker
- policy violation

Each item contains:

- requester
- reason
- impact/risk
- related entities
- evidence
- allowed actions

No approval should require searching chat history to understand the request.

---

## 18. Search and Command Palette

Global search searches:

- organizations
- projects
- tasks
- agents
- artifacts
- decisions
- schedules
- events

Command palette supports permission-aware quick commands.

Examples:

```text
Create Task
Open Agent
Request Review
Open Approval Inbox
Run Schedule
Create Decision Proposal
```

Commands not allowed by policy are hidden or shown disabled with explanation depending on context.

---

## 19. Status semantics

### Success / healthy / approved

Green

### Active / running / informational

Blue

### Selected / AOP identity / structured work

Purple

### Waiting / warning / medium risk

Amber

### Failed / blocked / critical / denied

Red

### Offline / inactive / superseded

Gray

Every state also includes text/icon semantics for accessibility.

---

## 20. Density system

AOP is an expert operational product, so desktop density is intentionally higher than a consumer SaaS product.

Use three density modes internally:

- Comfortable — default dashboards/details
- Compact — data tables/event streams
- Focus — coding/workspace panels

Avoid shrinking typography solely to fit more content. Prefer progressive disclosure and tabs.

---

## 21. Progressive disclosure

Five information depths:

```text
L0 Executive Summary
L1 Entity Operational State
L2 Evidence / Related Truth
L3 Runs / Events
L4 Raw Payload / Trace
```

Default UI targets L0-L2.

---

## 22. Realtime behavior

SSE organization stream updates:

- task state
- agent status
- run state
- approvals
- blockers
- artifacts
- decisions
- events
- schedule execution

UI must reconcile against Query API snapshot after reconnect.

Never rely on client-only event accumulation as source of truth.

---

## 23. Loading, stale, and failure states

Every major data panel supports:

- loading
- empty
- stale/reconnecting
- partial failure
- permission denied
- not found

Realtime disconnect must display a visible `Reconnecting / data may be stale` state.

---

## 24. Accessibility baseline

- keyboard accessible navigation
- visible focus states
- command palette keyboard operation
- semantic labels
- status not encoded only by color
- accessible contrast
- table headers and sorting semantics
- reduced-motion compatible animations

---

## 25. Responsive baseline

### Desktop

Full operational product.

### Tablet

Reduced multi-pane layouts; drawers replace persistent context rails where needed.

### Mobile

Prioritize:

- attention/approvals
- dashboard status
- task detail
- agent status
- discussion
- schedule
- event alerts

Complex graphs and dense workspace layouts are not P0 mobile requirements.

---

## 26. P0 screen inventory

1. Executive Dashboard
2. Organization Overview
3. Organization Chart
4. Project Workspace
5. Task Board/List
6. Task Detail
7. Agent Directory
8. Agent Detail
9. Artifact Registry
10. Artifact Detail
11. Decision Registry
12. Decision Detail
13. Approval Inbox
14. Agent Events
15. Event Detail
16. Schedule & Cron
17. Schedule Detail

---

## 27. Shared component inventory

### Layout

- AppShell
- Sidebar
- TopBar
- ContextSwitcher
- PageContainer
- PageHeader
- EntityHeader
- ContextRail
- SplitPane

### Data

- MetricCard
- DataTable
- FilterBar
- SearchInput
- EmptyState
- ErrorState
- ReconnectBanner

### State

- StatusBadge
- SeverityBadge
- LifecycleStepper
- ProgressBar
- VerifiedProgress
- AuthorityBadge
- VersionBadge

### Domain

- AgentAvatar
- AgentStatus
- TaskCard
- ApprovalCard
- ArtifactCard
- DecisionCard
- EventRow
- Timeline
- DependencyChip
- BlockerCard
- RunCard

### Interaction

- CommandButton
- CommandConfirmation
- ApprovalDialog
- EntityLink
- Drawer
- Tabs
- CommandPalette

---

## 28. Frontend source-of-truth rules

1. Query API provides current authoritative state.
2. SSE provides ordered changes/notification, not independent truth.
3. UI never invents task completion.
4. UI never infers permissions from role names alone.
5. UI uses exact artifact versions supplied by API.
6. Agent memory is labeled as memory, not truth.
7. Event sequence/correlation are inspectable.
8. Mutations go through Command API.
9. Approval-required commands must display the approval state.
10. Client optimistic UI may improve responsiveness but must reconcile with authoritative response.

---

## 29. Visual direction

Initial theme:

- dark navy/black shell
- elevated dark cards
- purple AOP identity/accent
- high information density
- subtle borders and shadows
- restrained glow effects
- compact rounded cards

The visual language should feel like an advanced operations/control product, not a gaming interface.

---

## 30. UX acceptance criteria for implementation

The first UI implementation is accepted only if:

- all P0 screens share the same navigation/detail patterns
- task/agent/artifact/decision state is sourced from Query API
- major state changes appear through SSE without full reload
- reconnect produces coherent state
- blocked/review/approval conditions are clearly visible
- every critical object is deep-linkable
- event and activity concepts remain distinct
- artifact versions and decision states are unambiguous
- user can understand a task without reading its complete conversation
- user can understand why a human approval is required
- no page requires raw logs for normal operating decisions
- responsive tablet/mobile degradation is graceful
- accessibility baseline is met

## 31. Implementation ownership

- CPO/UX: information architecture and behavior
- Product Design: visual system/components
- Frontend Engineering: application shell and components
- Query API team: authoritative projections
- Event team: ordered SSE updates
- QA: UX state/e2e/accessibility tests
- Security: permission-sensitive controls

## 32. Source-of-truth hierarchy

For frontend implementation:

1. AOP Protocol + architecture invariants
2. This UX/UI System document
3. Meeting #008 decisions
4. UI component implementation
5. Visual mockups/reference images

Mockups may change. Domain semantics may not be changed by design without an ADR/meeting decision.

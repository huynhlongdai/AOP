# Founding Company Meeting #008 — UX/UI Alignment

Date: 2026-08-25

## Purpose

Align the product, design, and engineering teams on one coherent UX/UI system for AOP before frontend implementation begins. The meeting consolidates the visual explorations for Dashboard, Agent Directory, Agent Detail, Task Board, Task Detail, Collaboration, Schedule/Cron, and Agent Events into a single information architecture and interaction model.

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
- Data/Query API representative
- QA/Evaluation Lead

## Opening constraint

AOP must not become a collection of attractive dashboards with inconsistent mental models.

The UI must reflect AOP's architecture:

- authoritative organizational state lives in the Kernel
- agents operate through bounded commands
- artifacts/decisions/reviews are authoritative objects
- messages are collaboration, not source of truth
- events provide auditability
- humans primarily manage goals, approvals, risks, and exceptions rather than individual prompts

## Discussion 1 — What is the product's primary mental model?

### CPO

The user should feel that they are operating an AI organization, not configuring a workflow engine.

### CTO

The UI cannot hide the actual state machines. A task that is `BLOCKED`, a run with an expired lease, or an artifact that became stale must be visible as a system condition rather than flattened into generic progress.

### UX Lead

The product therefore needs three simultaneous mental models:

1. **Organization** — who exists, who reports to whom, who has authority.
2. **Work** — goals, projects, tasks, runs, reviews, approvals.
3. **Truth & Audit** — artifacts, decisions, events, evidence, lineage.

### Decision UX-001

AOP's primary product metaphor is **AI Organization Operating System**.

It must not be designed primarily as chat, kanban, or workflow automation software.

---

## Discussion 2 — Global information architecture

The team reviewed the earlier mockups and removed duplicated or ambiguous top-level sections.

### Approved global navigation

```text
AOP
├── Dashboard
│
├── Organizations
├── Projects / Workspaces
│
├── Tasks
├── Agents
│
├── Artifacts
├── Decisions
│
├── Schedule & Cron
├── Events
│
├── Knowledge & Memory
├── Reports
│
└── Settings
```

Future-only sections:

```text
Agent Market
Skill Market
Company Templates
```

These may exist in design prototypes but are not part of the first implementation gate.

### Decision UX-002

The sidebar is organized by operational domain rather than by backend service/module names.

The active Organization/Project context is selected in a persistent context switcher near the top of the application.

---

## Discussion 3 — Four product layers

The UX Lead proposed grouping screens into four layers.

### Layer A — Executive

Primary screens:

- Executive Dashboard
- Organization overview
- Project portfolio
- Approvals
- Risks/blockers
- verified progress
- budget/usage

Question answered:

> What requires my attention and is the organization healthy?

### Layer B — Work

Primary screens:

- Project Workspace
- Task Board
- Task Detail
- discussion linked to work
- subtasks/dependencies
- reviews

Question answered:

> What is being worked on, by whom, and what is blocking delivery?

### Layer C — Workforce

Primary screens:

- Agent Directory
- Agent Detail
- Team Structure
- Roles & Permissions
- workload/performance

Question answered:

> Who is working, what can they do, and should they continue in this role?

### Layer D — Truth, Automation & Audit

Primary screens:

- Artifacts
- Decisions
- Schedule & Cron
- Events
- Knowledge/Memory

Question answered:

> What is authoritative, what changed, what will run next, and why did the system do this?

### Decision UX-003

Every feature must clearly belong to one of these four layers. Cross-links are encouraged, but duplicate source-of-truth screens are prohibited.

---

## Discussion 4 — Universal detail-page pattern

Earlier mockups used different layouts for agent/task/event pages. The team standardized them.

### Universal detail shell

```text
┌──────────────────────────────────────────────────┐
│ Breadcrumb / Identity / Status / Primary Actions │
├──────────────────────────────────────────────────┤
│ Lifecycle / progress / state / critical metadata │
├───────────────────────────────┬──────────────────┤
│ Main content + tabs           │ Context rail     │
│                               │                  │
│ Overview                      │ summary          │
│ Work / Inputs / Outputs       │ owner            │
│ Discussion                    │ approvals        │
│ Activity / Events             │ blockers         │
│ Metrics                       │ related objects  │
│                               │ quick actions    │
└───────────────────────────────┴──────────────────┘
```

### Shared behavior

- Header remains stable while changing tabs.
- Status is always visible.
- IDs and authoritative version/revision are inspectable.
- Right rail contains high-value context, not generic decoration.
- All mutating actions show policy/approval consequences before execution.
- Deep links preserve organization/project/entity context.

### Decision UX-004

Task, Agent, Artifact, Decision, Schedule, and Event detail pages must use the same detail shell unless a strong domain reason requires deviation.

---

## Discussion 5 — Dashboard

The Executive Dashboard must not become a vanity analytics page.

### Primary row

- active organizations/projects
- active agents
- open tasks
- verified completed work
- verified success/review pass rate
- budget/usage

### Operational health

- organization health
- task throughput
- agent utilization
- decision cycle time
- project health

### Attention panels

- approvals needed
- risks/blockers
- failed/retrying work
- stale artifacts
- critical events
- upcoming milestones

### Decision UX-005

The first viewport prioritizes **attention and verified state**, not historical charts.

Charts are secondary to actionable exceptions.

---

## Discussion 6 — Task Board and Task Detail

### Task Board

Approved default columns:

```text
Backlog → Ready → In Progress → Review → Done
```

`Blocked` is not a separate permanent column. A blocked task remains semantically tied to its current phase but carries a prominent blocker state and can be filtered into a dedicated blocker view.

Task cards show only:

- task ID/title
- priority
- owner agent
- relevant tags/capabilities
- progress/run indicator
- blocker/review indicators
- dependency indicator

### Task Detail

Mandatory sections:

- objective and scope
- lifecycle state
- acceptance criteria
- dependencies
- required input artifacts with exact versions
- outputs
- current run and run history
- lease state
- budget/tool usage
- subtasks
- decisions affecting the task
- blockers
- reviews/approvals
- discussion
- event/activity history

### Decision UX-006

A Task Detail page must make it possible to answer:

1. Why does this task exist?
2. What truth is it currently based on?
3. Who owns the execution lease?
4. What is blocking it?
5. What evidence is required before completion?
6. What changed since the last run?

without opening raw logs.

---

## Discussion 7 — Agent Directory and Agent Detail

### Agent Directory

The directory is a workforce management table, not a marketplace catalogue in the PoC.

Columns:

- agent
- role
- team/department
- runtime/model provider
- status
- capabilities/skills
- availability/workload
- verified performance
- cost/usage
- current assignment

### Agent Detail tabs

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

### Overview must show

- identity + role
- runtime/provider
- current status
- authority level
- current assignment
- active/queued tasks
- capabilities
- memory summary
- connected tools
- recent activity
- performance
- permissions/prohibitions
- manager/team relationships

### Important distinction

`Memory` is not presented as authoritative truth. The UI labels memory as learned/retrieved context and links authoritative decisions/artifacts separately.

### Decision UX-007

Agent Detail must distinguish:

- what the agent **is** (identity/role)
- what it **can do** (capabilities/tools/permissions)
- what it **knows/remembers** (memory)
- what it **is doing** (assignments/runs)
- how well it **has performed** (verified metrics)

---

## Discussion 8 — Collaboration / Discussion

The team rejected a design where collaboration becomes a detached Slack clone.

### Approved model

There are workspace channels and direct messages, but important discussions are always linkable to domain entities:

- Task
- Artifact
- Decision
- Review
- Incident/Event

A message may reference any of these objects.

A conversation can produce structured actions:

```text
Create Task
Create Decision Proposal
Publish Artifact
Request Review
Create Blocker
Schedule Meeting
```

### Decision UX-008

Conversation is a **working surface**.

Authoritative change requires an explicit organizational commit into Task/Decision/Artifact/Review state.

---

## Discussion 9 — Schedule & Cron

The calendar mockup was accepted conceptually but clarified.

### Schedule objects include

- agent jobs
- recurring tasks
- automation runs
- reviews
- deployment windows
- milestones
- reminders
- maintenance windows

### Views

- Month
- Week
- Day
- Agenda
- Schedules list
- Run history

### Schedule Detail

- status
- owner
- schedule expression
- human-readable recurrence
- timezone
- next run
- linked organization/project/task
- execution policy
- last runs
- success/failure rate
- average duration
- run now/pause actions

### Decision UX-009

Raw cron syntax is never the only representation. Every cron expression must also display a human-readable schedule and timezone.

---

## Discussion 10 — Agent Events

Events are an observability and audit product, not merely an activity feed.

### Event screen

Top-level filters:

- organization/project
- agent
- entity
- event type
- severity
- date range
- anomalies only

### Live stream rows

Each event shows:

- ordered time/sequence
- event type
- human-readable summary
- actor
- affected entity
- organization/project
- severity

### Event detail

- event ID
- organization sequence
- causation ID
- correlation ID
- actor
- target/aggregate
- source
- environment
- related task/run/artifact/decision
- structured details
- raw payload tab

### Decision UX-010

The UI distinguishes three concepts:

- **Activity** — human-friendly operational summary
- **Event** — authoritative immutable system record
- **Trace/Log** — low-level execution diagnostics

They are linked but not merged into one stream.

---

## Discussion 11 — Artifacts and Decisions

### Artifacts

Primary visualization:

- registry/list
- versions
- approval state
- producer task/agent
- consumers
- lineage graph
- stale/superseded indicators

### Decisions

Primary visualization:

- active decisions
- proposals pending approval
- superseded decisions
- authority/approver
- affected tasks/artifacts

### Decision UX-011

Authoritative artifacts and decisions use strong visual treatment and exact version/state labels. Chat messages or notes must never look equivalent to approved truth.

---

## Discussion 12 — Color and visual semantics

The dark visual direction from the prototypes is accepted as the initial product theme, but semantic colors are standardized.

### Base

- near-black/navy application shell
- dark elevated surfaces
- purple as AOP/product accent

### Semantic colors

- green = verified success / healthy / approved
- blue = active / information / running
- purple = AOP identity / selected / structured work
- amber = warning / waiting / medium risk
- red = failed / blocked / critical / denied
- gray = inactive / superseded / offline

### Decision UX-012

Color must never be the only carrier of state. Every semantic state also requires an icon, label, or text cue.

---

## Discussion 13 — Progressive disclosure

AOP contains large amounts of system state. Showing everything by default would make the product unusable.

Approved information levels:

```text
L0 Executive summary
L1 Operational object
L2 Evidence / related truth
L3 Events / runs
L4 Raw payload / trace
```

Users move downward only when needed.

### Decision UX-013

The default interface optimizes for L0-L2. Raw traces, payloads, IDs, and debugging data remain one click away but are not primary visual content.

---

## Discussion 14 — Human control model

Primary human interaction should be exception-driven.

Global attention center contains:

- approval required
- decision required
- blocked critical task
- budget threshold
- permission request
- repeated runtime failure
- stale critical artifact
- policy violation

### Decision UX-014

AOP must allow the Founder/manager to understand and intervene in an organization without reading every agent conversation.

---

## Discussion 15 — Responsive strategy

Desktop is the primary operational surface for the PoC.

Tablet/mobile are observer/control surfaces first.

On mobile prioritize:

- dashboard attention items
- approvals
- task/agent status
- discussion
- schedule
- alerts/events

Do not attempt to reproduce dense desktop task graphs or multi-pane workspaces in the first mobile implementation.

### Decision UX-015

Desktop-first implementation; mobile-first exception management.

---

## Final approved screen set for first UI implementation

### P0 — Required for the PoC

1. Executive Dashboard
2. Organization Overview + Org Chart
3. Project Workspace
4. Task Board
5. Task Detail
6. Agent Directory
7. Agent Detail
8. Artifact Registry + Artifact Detail
9. Decision Registry + Decision Detail
10. Approval Inbox
11. Agent Events + Event Detail
12. Schedule & Cron

### P1 — After P0

13. Collaboration Workspace
14. Knowledge & Memory explorer
15. Reports / Experiment metrics
16. Team/Role/Permission management UI
17. Run inspector / trace explorer

### P2 — Post-PoC / Marketplace phase

18. Agent Market
19. Skill Market
20. Company Templates
21. Recruitment workflow
22. Reputation/career screens

---

## Design-system decision

Initial implementation should use reusable primitives for:

- AppShell
- Sidebar
- ContextSwitcher
- PageHeader
- EntityHeader
- StatusBadge
- LifecycleStepper
- MetricCard
- DataTable
- KanbanBoard/Card
- DetailTabs
- ContextRail
- ActivityTimeline
- EventRow
- ApprovalCard
- ArtifactVersionBadge
- AgentAvatar/Status
- Empty/Error/Loading state
- CommandConfirmation

The team should not build page-specific copies of these patterns.

---

## Final UX principles

1. **State over conversation.**
2. **Evidence over self-report.**
3. **Exceptions over noise.**
4. **Context over broadcast.**
5. **Authority is visible.**
6. **Every important action is traceable.**
7. **Every important object is deep-linkable.**
8. **Progress must be verified, not decorative.**
9. **Human intervention must be obvious and bounded.**
10. **One design language across Organization, Work, Workforce, and Audit.**

## Meeting outcome

UX/UI direction is approved for implementation.

The visual mockups created before this meeting are treated as exploration references. This meeting and the accompanying `docs/design/UX_UI_SYSTEM_v0.1.md` are the source of truth for frontend behavior and information architecture.

The UI remains an observer/control layer over the Organization Kernel; it must never invent state that does not exist in the Query API.

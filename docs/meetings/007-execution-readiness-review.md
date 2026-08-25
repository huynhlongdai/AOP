# Founding Company Meeting #007 — Execution Readiness Review

Date: 2026-08-25

## Purpose

Final planning meeting before implementation. Convert Meetings #001–#006 into a dependency-ordered engineering backlog, resolve remaining PoC-level ambiguities, define Definition of Done, and decide whether architecture planning is sufficiently complete to start coding.

## Participants

- Founder representative
- Chief of Staff
- CEO
- CTO
- Platform Architect
- Data Architect
- Agent Runtime Architect
- Security Architect
- SRE
- QA/Evaluation Lead
- CPO

## Opening rule

No new architecture is introduced unless an unresolved issue prevents implementation.

The team must prefer the smallest design that preserves AOP's core invariants.

## Final technology baseline for PoC

### Monorepo

- pnpm workspaces
- TypeScript for Kernel/API/Web/shared packages
- Python permitted for runtime adapters where provider capabilities require/benefit from it

### Backend

- Fastify
- PostgreSQL
- Drizzle ORM plus explicit migrations
- Zod/JSON Schema at protocol/command boundaries

### Worker/event processing

- PostgreSQL outbox/job tables
- idempotent worker consumers
- periodic reconciliation

### Artifacts

- S3-compatible object storage
- Git for code artifacts/workspaces

### Frontend

- React + Vite
- query/cache library for Query API state
- SSE client for live organization events
- graph visualization library for task/org graphs

### Testing

- unit/integration test runner in TypeScript ecosystem
- Playwright-style browser E2E
- Docker-backed PostgreSQL integration tests
- chaos/failure-injection harness

### Observability

- structured JSON logs
- OpenTelemetry-compatible traces/metrics
- provider-native traces linked below organization/run traces

Exact library versions are locked by the implementation branch/lockfile rather than this architecture document.

## Repository target structure

```text
AOP/
├── apps/
│   ├── api/
│   ├── worker/
│   ├── web/
│   └── sandbox-runner/
│
├── packages/
│   ├── protocol/
│   ├── domain/
│   ├── database/
│   ├── command-bus/
│   ├── event-bus/
│   ├── policy-engine/
│   ├── scheduler/
│   ├── artifact-store/
│   ├── context-engine/
│   ├── runtime/
│   ├── runtime-openai/
│   ├── runtime-a2a/
│   ├── tools-mcp/
│   ├── observability/
│   └── testing/
│
├── examples/
│   └── software-company/
│
├── scenarios/
│   ├── url-shortener/
│   └── github-repo-analyzer/
│
├── tests/
│   ├── integration/
│   ├── contract/
│   ├── e2e/
│   └── chaos/
│
├── docs/
│   ├── history/
│   ├── meetings/
│   ├── protocol/
│   ├── architecture/
│   ├── implementation/
│   └── adr/
│
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

## Engineering epics

### EPIC-00 — Repository foundation

Deliverables:

- monorepo/workspace configuration
- shared TypeScript config
- formatting/linting/typecheck
- test infrastructure
- Docker Compose baseline
- CI workflow
- environment template

Acceptance:

- fresh clone installs and builds
- CI runs on pull request
- PostgreSQL/MinIO local stack starts deterministically

Dependencies: none.

---

### EPIC-01 — AOP protocol package

Deliverables:

- identifiers/principals
- Organization schema
- Agent/OrganizationMembership schema
- Role schema
- Goal schema
- Task/TaskRun schema
- Artifact/ArtifactVersion schema
- Decision schema
- Review schema
- Lease schema
- Permission schema
- Approval schema
- Command Envelope
- Event Envelope
- Context Manifest schema
- error model
- protocol version header/constants

Acceptance:

- every schema has runtime validation
- JSON fixtures pass/fail predictably
- package imports no DB/web/provider SDK
- compatibility fixtures are committed

Dependencies: EPIC-00.

---

### EPIC-02 — Database and migrations

Deliverables:

- tables agreed in Meeting #004
- foreign keys
- unique/partial indexes
- organization event sequence allocator
- migration tooling
- test fixture/seeding utilities

Acceptance:

- clean database migrates from zero
- constraints block dual active leases where DB-level protection applies
- artifact versions cannot be updated through repository method after commit
- migration test runs in CI

Dependencies: EPIC-01.

---

### EPIC-03 — Domain state machines and invariants

Deliverables:

- Organization domain service
- Membership/Role domain service
- Goal domain service
- Task state machine
- hard dependency DAG validation
- readiness calculation
- Artifact version rules
- Decision lifecycle
- Review lifecycle
- Approval lifecycle

Acceptance:

- invalid state transitions rejected
- hard dependency cycles rejected
- ordinary worker cannot transition directly to completed
- artifact version immutability enforced
- tests cover every allowed/denied transition

Dependencies: EPIC-01, EPIC-02.

---

### EPIC-04 — Command Gateway, Policy and Event/Outbox

Deliverables:

- `POST /v1/organizations/{orgId}/commands`
- command schema registry
- idempotency table/handler
- optimistic revision checks
- explicit Principal model
- Policy Engine interface/rules
- ALLOW/DENY/REQUIRE_APPROVAL
- domain event creation
- transactional outbox
- worker publisher
- machine-readable errors

Acceptance:

- repeated idempotency key produces one mutation
- conflicting revision returns REVISION_CONFLICT
- mutation+event+outbox are atomic
- unauthorized action rejected independent of model output
- approval-required command creates durable request

Dependencies: EPIC-02, EPIC-03.

---

### EPIC-05 — Query API and live organization stream

Deliverables:

- organization snapshot
- goals/tasks queries
- task inspector query
- artifacts/versions query
- decisions/reviews query
- approvals query
- ordered events query using sequence cursor
- SSE organization event stream

Acceptance:

- query endpoints have no side effects
- SSE reconnect can resume after known sequence
- snapshot + SSE produces coherent observer state after reconnect

Dependencies: EPIC-04.

---

### EPIC-06 — Task Runs, Scheduler and Lease Manager

Deliverables:

- TaskRun creation
- scheduler candidate filtering
- basic role/capability/load ranking
- lease acquire/heartbeat/release
- lease reaper
- task readiness consumer
- periodic readiness/lease reconciliation
- structured failure classifications
- retry budgets

Acceptance:

- hard dependency blocks downstream task
- completion/unblock event makes dependent task READY
- two scheduler workers cannot create two active task leases
- expired run becomes LOST and task can be rescheduled
- retry limit prevents infinite loop

Dependencies: EPIC-04.

---

### EPIC-07 — Artifact Registry and Impact Engine

Deliverables:

- artifact logical identity/version publishing
- object-store adapter
- checksum verification
- task input/output links
- artifact lineage
- approval/supersede flow
- stale-input detection
- change impact queue
- simple trivial/moderate/breaking classifier boundary

Acceptance:

- version publication is immutable
- superseding API spec identifies consumers
- breaking input can pause/flag affected running work
- artifact provenance is queryable

Dependencies: EPIC-04, EPIC-06.

---

### EPIC-08 — Decision, Review and Management Reporting

Deliverables:

- Decision Registry API/domain
- authority check for decision approval
- Review workflow
- evidence association
- verified task completion
- organization status projection
- verified progress calculation
- structured management report

Acceptance:

- active decision cannot be changed by conversation/message alone
- QA rework sends task through valid rework state
- completed status requires review policy satisfaction
- reported completion derives from Kernel state/evidence

Dependencies: EPIC-04, EPIC-07.

---

### EPIC-09 — Context Compiler and Context Manifest

Deliverables:

- resolver pipeline
- trust/authority classes
- mandatory fragment handling
- artifact/decision resolvers
- prior-attempt resolver
- memory retrieval interface (minimal implementation acceptable initially)
- capability resolver
- token/context budgeting
- Context Manifest persistence/hash

Acceptance:

- task run context includes exact current required artifact versions
- active decisions/policies cannot be removed by semantic ranking
- external evidence cannot redefine role authority
- context manifest allows reproduction/audit of authoritative inputs
- required context overflow fails explicitly rather than silently dropping policy

Dependencies: EPIC-07, EPIC-08.

---

### EPIC-10 — Runtime Manager and first real agent adapter

Deliverables:

- Runtime Adapter interface
- Runtime Manager worker
- run preparation/start/cancel/inspect
- lease heartbeat integration
- normalized runtime status/events
- structured Run Report
- first model/agent adapter
- usage/trace collection
- AOP organization tool wrappers

Acceptance:

- real CTO agent can receive a Work Contract and create valid child-task commands
- invalid command from agent is rejected by Kernel without corrupting state
- runtime failure becomes structured run failure/loss
- run traces correlate back to organization/task/context manifest

Dependencies: EPIC-06, EPIC-09.

---

### EPIC-11 — Workspace, sandbox and MCP tool fabric

Deliverables:

- Workspace interface
- Git worktree adapter
- workspace snapshot metadata
- sandbox interface
- local/container sandbox implementation
- sandbox profiles
- per-run capability/tool binding
- MCP client/tool adapter boundary
- secret isolation

Acceptance:

- two coding runs cannot mutate the same worktree
- sandbox receives no Kernel DB credential
- runtime gets only policy-approved tools
- killed sandbox can resume from durable work/snapshot in recovery test

Dependencies: EPIC-10.

---

### EPIC-12 — Five-role Software Company template

Deliverables:

- Founder/CEO/CTO/Backend/Frontend/QA roles
- role responsibilities
- authority/prohibition policies
- initial capabilities
- reporting relationships
- initial agent instructions/contracts
- company creation seed/template

Acceptance:

- one command/action creates the template organization deterministically
- every agent has bounded authority
- engineer cannot self-hire/self-promote/deploy protected production action

Dependencies: EPIC-04, EPIC-10.

---

### EPIC-13 — Organization Observer Web UI

Deliverables:

- organization dashboard
- org chart
- goal/task graph
- task inspector
- artifact registry
- decision registry
- run inspector
- event timeline
- approval inbox

Acceptance:

- UI reads authoritative Query API
- no fake completion/progress state exists only in frontend
- SSE updates visible state and reconnect works
- human can resolve approval request

Dependencies: EPIC-05, EPIC-08, EPIC-10.

---

### EPIC-14 — Scenario A: URL Shortener

Deliverables:

- scenario objective
- acceptance test suite
- seed environment/repository
- controlled perturbation scripts
- evaluator rubric

Company must execute:

```text
Founder objective
 -> CEO planning
 -> CTO decomposition
 -> BE/FE work
 -> artifact contracts
 -> QA review/rework
 -> integration
 -> verified result
```

Perturbations:

- API spec breaking change
- backend runtime kill
- QA rejection

Acceptance:

- final product acceptance suite is machine-verifiable
- all organization decisions/tasks/artifacts/runs remain auditable

Dependencies: EPIC-11, EPIC-12, EPIC-13.

---

### EPIC-15 — Chaos and adversarial harness

Deliverables:

- kill run/sandbox
- expire lease
- duplicate command
- delay/replay outbox work
- invalidate/supersede artifact
- provider/tool timeout injection
- approval delay/rejection
- permission attack fixture
- prompt-injection fixture
- cross-organization attack fixture

Acceptance:

- each failure has expected deterministic invariant/result
- no test requires manual DB repair to continue
- failures are recorded in experiment evidence

Dependencies: EPIC-06 through EPIC-11.

---

### EPIC-16 — Baseline and evaluation harness

Deliverables:

- Experiment schema/store
- SINGLE_AGENT runner
- SUPERVISOR_MULTI_AGENT runner
- AOP_ORGANIZATION runner
- equivalent environment/objective controls
- product correctness metrics
- autonomy metrics
- coordination metrics
- reliability metrics
- efficiency metrics
- governance metrics
- experiment report generator

Acceptance:

- same Scenario A can run in all three modes
- exact configuration/version evidence persists
- comparison does not rely only on subjective model grading

Dependencies: EPIC-14, EPIC-15.

---

### EPIC-17 — Scenario B: GitHub Repository Analyzer

Adds external tooling/background complexity after Scenario A is stable.

Acceptance follows the same experiment/evidence model.

Dependencies: EPIC-16 and Scenario A exit gates.

## Ordered implementation slices

The epics are grouped into execution slices.

### Slice 0 — Foundation

EPIC-00, 01, 02, 03, 04.

Exit gate:

A deterministic Kernel can create an organization/goal/task, enforce transitions/policy/revisions/idempotency, and emit atomic events/outbox records.

### Slice 1 — Coordination

EPIC-05, 06.

Exit gate:

Task DAG + scheduler + runs + leases operate correctly under multiple worker processes and recovery/reconciliation tests.

### Slice 2 — Organizational truth

EPIC-07, 08.

Exit gate:

Artifacts, decisions, reviews, stale inputs, verified completion, and management projections are authoritative and auditable.

### Slice 3 — Intelligence boundary

EPIC-09, 10.

Exit gate:

A real agent can receive compiled context and act only through bounded AOP commands, with traceable Context Manifest and runtime state.

### Slice 4 — Real work environment

EPIC-11, 12, 13.

Exit gate:

Five-role company exists; workers have isolated workspaces/sandbox tools; human can observe/control organization through UI.

### Slice 5 — Product PoC

EPIC-14, 15.

Exit gate:

AOP Company completes Scenario A and recovers from required perturbations while preserving invariants.

### Slice 6 — Scientific comparison

EPIC-16, 17.

Exit gate:

Comparable experiments produce enough evidence to decide whether AOP organization architecture creates real value over simpler approaches.

## Critical dependency chain

```text
Protocol
  -> DB
  -> Domain invariants
  -> Command/Policy/Event
  -> Scheduler/Lease
  -> Artifact/Decision/Review
  -> Context Compiler
  -> Runtime
  -> Sandbox/Tools
  -> Company Template
  -> Scenario
  -> Chaos/Evaluation
```

The web UI can progress partially in parallel after Query API exists, but must never become the critical architecture driver.

## Definition of Done — implementation item

No task/PR is considered done unless applicable conditions pass:

- code compiles/typechecks
- tests added/updated
- protocol/domain schema updated when required
- migration added when required
- no direct DB bypass of domain/command invariants
- structured error behavior defined
- authorization considered/tested
- event/audit behavior defined
- idempotency considered for side effects
- observability fields/correlation present
- docs/ADR updated for architecture changes

## Definition of Done — AOP PoC

The first PoC is complete only when:

1. Organization state survives runtime/sandbox process loss.
2. Agents cannot directly mutate authoritative DB state.
3. Commands are revision-safe and idempotent.
4. Task graph enforces hard dependencies and cycle prevention.
5. Scheduler/leases avoid duplicate active execution.
6. Artifact versions are immutable and provenance is recorded.
7. Breaking authoritative input changes trigger impact handling.
8. Decisions are authoritative objects, not conversation memory.
9. Task completion is verified by review/evidence policy.
10. Context Manifest records the authoritative context of each run.
11. Permanent memory cannot silently overwrite organizational truth.
12. Agent permissions are deterministic and bounded.
13. Real agents execute through Runtime Manager and scoped tools.
14. Coding workspaces are isolated.
15. Recoverable failures recover without manual DB repair.
16. Founder can inspect organization state and resolve approvals in UI.
17. Scenario A completes with machine-verifiable product tests.
18. Chaos suite passes required invariants.
19. Experiment harness can compare AOP to simpler baselines.
20. All architecture/protocol decisions are documented in the repo.

## Risks retained for implementation validation

These are not planning blockers but must be measured.

### R1 — Coordination overhead may exceed benefit

Mitigation: baseline experiments and AVWR/coordination metrics.

### R2 — Context Compiler may become overly complex

Mitigation: mandatory deterministic fragments first; minimal memory retrieval initially.

### R3 — LLM task decomposition quality may dominate outcomes

Mitigation: separate Kernel correctness metrics from agent intelligence metrics; compare providers/configurations later.

### R4 — Sandbox/tooling may consume most engineering effort

Mitigation: adapter boundary; use existing sandbox capability where possible; local implementation only needs PoC requirements.

### R5 — Artifact impact classification may produce false positives/negatives

Mitigation: explicit lineage/dependencies first, model classification second, human escalation for high-risk ambiguity.

### R6 — Agent hierarchy may be unnecessary for small tasks

Mitigation: organizational intelligence should eventually choose smaller structures; benchmark includes single agent.

### R7 — Multi-provider portability may be harder than protocol suggests

Mitigation: ship one real adapter first while keeping protocol/runtime interfaces provider-neutral; A2A adapter comes after local runtime path is stable.

## Architecture planning freeze

The meeting agrees to freeze these PoC architectural principles unless implementation evidence requires an ADR change:

- Dumb Kernel, Smart Agents
- Shared truth, selective memory
- modular monolith
- PostgreSQL authoritative state
- Command -> Policy -> Domain -> Event
- immutable artifact versions
- task/run/lease separation
- deterministic policy/scheduler core
- Context Manifest per run
- durable workspace / disposable sandbox
- provider-neutral runtime adapters
- MCP for tools, A2A for remote agents
- state-first observer UI
- benchmark before marketplace

## Final readiness vote

### CTO

Ready for implementation. Core correctness boundaries are explicit.

### Data Architect

Ready. Schema can evolve through migrations without unresolved fundamental ownership ambiguity.

### Runtime Architect

Ready. Runtime boundary and recovery contract are sufficiently defined to build one adapter first.

### Security Architect

Ready for PoC provided deterministic policy and sandbox secret isolation are implemented before granting meaningful external capabilities.

### QA/Evaluation Lead

Ready. Go/no-go gates and benchmark design exist before claims are made.

### CPO

Ready. Minimal observer/control UI is clear and does not force a chat-first architecture.

### CEO / Chief of Staff

Planning phase complete. Marketplace/business expansion remains intentionally deferred until Organization Kernel evidence exists.

## Decision

> **AOP PoC implementation plan is execution-ready. Formal architecture meetings can stop here and implementation can begin with Slice 0.**

Future meetings should be triggered by implementation evidence, failed acceptance gates, or ADR-worthy design changes rather than continuing speculative planning indefinitely.

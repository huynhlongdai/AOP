# Founding Company Meeting #003 — Implementation Design

Date: 2026-08-25

## Purpose

Translate AOP v0.1 from conceptual protocol into an implementation architecture suitable for a real proof of concept.

The central engineering requirement was:

> Every design decision must identify which module executes it, where the data lives, which transaction protects it, and what happens when the process dies.

## D003-01 — Modular monolith first

The PoC will begin as a modular monolith rather than microservices.

Modules remain strongly separated so they can be extracted later if needed.

Initial server modules:

- Organization
- Identity / Role
- Goal
- Task
- Scheduler
- Artifact
- Decision
- Review
- Policy
- Context Compiler
- Runtime Manager
- Event / Outbox

This avoids distributed-system operational complexity before AOP itself is proven.

## Proposed monorepo

```text
agent-org/
├── apps/
│   ├── api/
│   ├── worker/
│   ├── web/
│   └── sandbox-runner/
├── packages/
│   ├── protocol/
│   ├── domain/
│   ├── database/
│   ├── event-bus/
│   ├── policy-engine/
│   ├── context-engine/
│   ├── scheduler/
│   ├── runtime/
│   ├── runtime-openai/
│   ├── runtime-a2a/
│   ├── tools-mcp/
│   ├── artifact-store/
│   ├── observability/
│   └── testing/
├── examples/
│   └── software-company/
├── docs/
│   ├── architecture/
│   ├── protocol/
│   └── adr/
└── tests/
    └── chaos/
```

`packages/protocol` must remain independent of OpenAI, PostgreSQL, web framework, and deployment platform.

## Command Envelope

All state-changing requests use a structured command envelope containing:

- command_id
- type
- organization_id
- actor
- target
- expected_revision
- idempotency_key
- payload
- issued_at

Three fields are critical:

### Actor

Every organizational action must be attributable.

### expected_revision

Supports optimistic concurrency. If two processes read revision 7 and one successfully mutates to revision 8, the other command using expected_revision 7 must fail with a revision conflict rather than silently overwriting newer state.

### idempotency_key

Allows safe retries after network/process failures without creating duplicate side effects.

A deduplication table stores prior command results for repeated idempotency keys.

## Event Envelope

Every committed authoritative mutation creates an immutable event containing:

- event id
- organization id
- organization sequence
- event type
- aggregate/entity and revision
- actor
- causation id
- correlation id
- payload
- occurred_at

Command is intent. Event is a committed fact.

## PostgreSQL model

Initial tables:

- organizations
- agents
- roles
- role_assignments
- goals
- tasks
- task_dependencies
- task_runs
- leases
- artifacts
- artifact_versions
- task_artifact_inputs
- task_artifact_outputs
- decisions
- decision_impacts
- reviews
- permissions
- events
- outbox_events
- command_deduplication

Marketplace, billing, reputation, and social features are explicitly excluded from the PoC database.

## Task vs Task Run

A major implementation distinction:

> Task is a work contract. Task Run is one execution attempt.

A single task may have multiple runs:

```text
TASK-184
  run 1 -> runtime crashed
  run 2 -> tests failed
  run 3 -> accepted
```

`task_runs` stores:

- task id
- agent id
- attempt
- run status
- runtime type/id
- workspace id
- snapshot id
- start/heartbeat/finish timestamps
- failure reason

A lease belongs to active execution ownership. When a run is lost, a new run is created rather than reviving a dead attempt as though nothing happened.

## Artifact storage

PostgreSQL stores artifact metadata, not large contents.

Artifact content may live in:

- S3-compatible object storage
- Git for source code
- later remote systems

A logical AOP URI such as `aop://org_01/artifacts/api-spec/5` should hide the storage backend.

Artifact lineage tracks `derived_from` relationships so impact analysis can traverse graph edges rather than rely only on semantic search.

## Decision impact graph

Decisions may influence architecture/artifacts/tasks. When a decision is superseded, the Impact Engine follows explicit relations to identify affected work before any LLM analysis of significance.

## Policy Engine

Authorization API concept:

```text
authorize(actor, command, target, organization, context)
  -> ALLOW | DENY | REQUIRE_APPROVAL
```

Policies must not be encoded merely as prompts. Kernel policy remains deterministic and external to runtime reasoning.

## Scheduler v0

Scheduler is initially deterministic:

1. observe READY task
2. validate hard dependencies
3. resolve required capabilities
4. find eligible agents
5. filter permission and availability
6. rank by role/capability/load/history/cost
7. create task run
8. acquire lease

Events provide the fast path. Periodic DB reconciliation is the correctness path in case an event is missed or a consumer fails.

## PostgreSQL Outbox

Authoritative state mutation, domain event, and outbox record commit in one transaction.

An asynchronous worker publishes outbox events using safe locking/retry. This avoids introducing Kafka or another distributed broker before the PoC needs one.

## Context Compiler pipeline

The compiler should be a pipeline rather than a single opaque retrieval function:

```text
Task
 -> IdentityResolver
 -> RoleResolver
 -> AuthorityResolver
 -> GoalResolver
 -> TaskResolver
 -> DependencyResolver
 -> DecisionResolver
 -> ArtifactResolver
 -> MemoryRetriever
 -> ToolResolver
 -> Budgeter
 -> ContextAssembler
```

Each stage emits Context Fragments with metadata such as kind, authority, relevance, mandatory flag, token estimate, source revision, and content.

Mandatory authoritative context includes task contract, active blocking decisions, permissions, and required artifact versions. Semantic memory is optional and dropped before authoritative material when the token budget is constrained.

## Context Manifest

Every run persists a Context Manifest listing exactly which task revision, artifact versions, decisions, and other authoritative inputs were compiled.

This provides reproducibility and makes context-engine bugs auditable. If an agent implements the wrong API, the system can check whether the run received an obsolete API spec rather than guessing from model behavior.

## Runtime boundary

Kernel remains provider-neutral.

Conceptual runtime interface:

- start
- resume
- cancel
- inspect

Runtime input includes:

- Agent Definition
- Context Manifest
- Workspace
- Tools
- Execution Policy

Workers do not receive DB mutation access. They receive bounded Organization capabilities such as task.create, task.block, artifact.publish, decision.propose, message.send, review.submit.

Each call becomes:

```text
Command Handler -> Policy -> Domain -> Transaction -> Event
```

## Runtime adapters

Potential adapters:

- OpenAI
- Claude
- Gemini
- local runtime
- OpenClaw
- remote A2A agent

OpenAI is only the first adapter, not the definition of the product.

Kernel is planned in TypeScript while runtime processes may use TypeScript or Python behind a clean process/protocol boundary.

## MCP and A2A

MCP remains the tool/data layer. Kernel should not grow custom integrations for every external service.

A2A is used for remote independent workers. AOP metadata such as goal, role, authority, acceptance criteria, and artifact requirements remains under the Organization Kernel.

## Workspace isolation

Coding tasks should not share one mutable working tree.

Each Task Run uses an isolated workspace or Git worktree/branch such as:

```text
agent/task-101/run-2
```

Merge/integration is itself treated as work with tests and review, not an assumed trivial operation.

## Sandbox lifecycle

```text
Task READY
 -> Run created
 -> Workspace prepared
 -> Sandbox created
 -> Context compiled
 -> Agent starts
 -> checkpoints
 -> Artifact published
 -> Sandbox stopped
```

A new sandbox can rehydrate from the latest durable workspace snapshot if compute disappears.

## Observability

Three trace layers are intentionally separated:

1. infrastructure trace — HTTP, DB, queue, sandbox
2. agent trace — model calls, tool calls, handoffs, runtime errors
3. organization trace — goal, task, decision, artifact, review

Correlation connects organization -> goal -> task -> run -> agent trace.

No system should depend on private chain-of-thought for auditing. User-visible audit relies on actions, evidence, artifacts, decisions, tools, failures, and summaries.

## Reporting Engine

Executives should read verified organization state, not estimate progress from memory.

Reporting queries goals, tasks, dependencies, reviews, risks, budgets, and events to produce a structured status. The model may explain the status but does not invent completion percentages.

## Human approvals

Human approval is persistent workflow state, not a chat pause.

Approval request fields include:

- organization
- source command
- requester
- type
- payload
- risk
- status
- expiry

Approval or rejection resumes the deterministic workflow.

`BLOCKED` should use structured reasons such as dependency, human_input, external_system, resource, decision, and capability_gap rather than multiplying task statuses unnecessarily.

## Software Company template

Initial roles:

- Founder (human)
- CEO
- CTO
- Backend Engineer
- Frontend Engineer
- QA

Each role gets bounded command/capability authority. Persona is a secondary layer; role contract and available commands are primary.

## Vertical-slice implementation order

### Slice 0 — Kernel

Organization, Role, Goal, Task, Command, Event.

Acceptance: create an organization, goal, task, and validated state transition.

### Slice 1 — Coordination

Dependencies, task runs, leases, scheduler.

Acceptance: Task B remains blocked on A; completing A makes B READY.

### Slice 2 — Artifacts

Publish/version artifacts, track consumers, stale input detection.

Acceptance: API spec v1 -> v2 marks affected frontend work stale.

### Slice 3 — Runtime

Connect one real agent (initially CTO) that receives a task and proposes valid structured task-creation commands.

### Slice 4 — Multi-agent

CEO + CTO + Backend + Frontend + QA.

### Slice 5 — Coding

Git workspaces, sandbox, MCP tools, tests.

### Slice 6 — Chaos

Kill runtime, expire lease, modify spec, reject review, duplicate command, attempt unauthorized action.

## Initial scenarios

Scenario 1: URL shortener with authentication.

Small enough for repeatable testing while requiring API, database, frontend, review, and integration.

Scenario 2: GitHub repository analyzer.

Introduces external APIs/background work and better approximates the long-term developer-tool/company use case.

## Benchmark harness

Every experiment records:

- experiment id
- scenario
- mode
- model
- token usage
- tool calls
- wall time
- human interventions
- test score
- artifact score
- integration score
- failures

Modes:

- SINGLE_AGENT
- SUPERVISOR_MULTI_AGENT
- AOP_ORGANIZATION

## Metrics

### Autonomous Verified Work Rate (AVWR)

Conceptually optimizes verified completed work relative to human intervention and cost.

### Coordination Error Rate

Tracks duplicate work, stale input, conflicting decisions, dependency mistakes, and races per unit of work.

### Recovery Rate

Successful autonomous recoveries divided by injected failures.

## Long-term moat hypothesis

The defensible layer is increasingly seen as:

```text
Organization State
+
Context Compiler
+
Work Protocol
+
Evaluation Data
```

At scale the platform may learn which team structure, role, model, context, review policy, and communication pattern produce the best outcome for each work type. This is referred to as **Organizational Intelligence**.

## Meeting decisions

| ID | Decision |
| --- | --- |
| D003-01 | Modular monolith before microservices |
| D003-02 | PostgreSQL is authoritative state |
| D003-03 | Command and Event are separate concepts |
| D003-04 | State-changing commands support idempotency |
| D003-05 | Use optimistic concurrency with revisions |
| D003-06 | Task and Task Run are separate |
| D003-07 | Runtime is disposable |
| D003-08 | Artifact content lives outside relational DB |
| D003-09 | Persist Context Manifest for every run |
| D003-10 | Policy Engine is deterministic |
| D003-11 | Scheduler v0 is deterministic |
| D003-12 | Agents have no direct database mutation access |
| D003-13 | OpenAI is only runtime adapter #1 |
| D003-14 | MCP is the tool-interoperability layer |
| D003-15 | A2A is the remote-agent interoperability layer |
| D003-16 | Isolate coding agents with Git worktrees/branches |
| D003-17 | PoC requires chaos testing |
| D003-18 | Benchmark against single-agent and simple supervisor |

## Sprint 0 target defined

The first end-to-end slice should demonstrate:

```text
Create Software Company
 -> create CEO
 -> founder gives objective
 -> CEO receives work
 -> CEO creates engineering goal
 -> CEO delegates to CTO
 -> CTO decomposes work
 -> Kernel persists commands/events/state
 -> observer UI shows the real organization state
```

No marketplace UI and no requirement for real product coding are needed in this first slice. The next meetings must close remaining implementation ambiguities before coding begins.

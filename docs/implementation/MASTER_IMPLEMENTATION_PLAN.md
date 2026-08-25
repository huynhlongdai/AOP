# AOP Master Implementation Plan

Status: **READY FOR IMPLEMENTATION — SLICE 0**

Date: 2026-08-25

Source of decisions: Founding Company Meetings #001–#007.

## 1. Mission

Build and validate an Agent Organization Protocol / Organization Kernel that allows AI workers to operate as a persistent software company with deterministic coordination, bounded authority, durable state, selective context, versioned artifacts, verified completion, and autonomous recovery.

The first product is not the public Agent Marketplace. The first product is the **Organization Kernel + Observer + five-role Software Company PoC**.

## 2. Core proof

AOP succeeds only if it demonstrates that a structured organization can produce verified work with better coordination/recovery and/or less human mediation than simpler agent architectures on sufficiently complex tasks.

Comparison modes:

1. Single strong agent
2. Simple supervisor multi-agent
3. AOP Organization

## 3. Frozen PoC principles

- Dumb Kernel, Smart Agents
- Shared truth, selective memory
- Organization state outlives runtime processes
- Commands are intents; Events are committed facts
- PostgreSQL is authoritative state
- all authoritative writes pass Command -> Policy -> Domain -> Transaction -> Event
- idempotency and optimistic concurrency from the start
- task and task-run are separate
- lease-based active execution ownership
- immutable artifact versions
- decisions/reviews are structured authoritative objects
- context compiled per run with Context Manifest
- durable workspace, disposable sandbox
- deterministic permission/policy enforcement
- provider-neutral runtime adapters
- MCP for tools/data
- A2A for remote agents
- state-first Observer UI
- evaluate before building marketplace

## 4. PoC organization

```text
Founder (human)
   |
  CEO
   |
  CTO
 / | \
BE FE QA
```

### CEO

Owns product/company goal decomposition and executive delegation.

### CTO

Owns engineering plan, architecture decisions, engineering task graph, and integration.

### Backend Engineer

Implements bounded backend work and publishes code/contracts/tests.

### Frontend Engineer

Consumes approved product/API contracts and implements bounded UI work.

### QA

Validates acceptance criteria/evidence and may request rework.

## 5. System components

```text
apps/api
apps/worker
apps/web
apps/sandbox-runner

packages/protocol
packages/domain
packages/database
packages/command-bus
packages/event-bus
packages/policy-engine
packages/scheduler
packages/artifact-store
packages/context-engine
packages/runtime
packages/runtime-openai
packages/runtime-a2a
packages/tools-mcp
packages/observability
packages/testing
```

## 6. Data backbone

PostgreSQL tables to implement first:

- organizations
- agents
- organization_memberships
- roles
- role_assignments
- goals
- tasks
- task_dependencies
- task_runs
- leases
- artifacts
- artifact_versions
- artifact_lineage
- task_artifact_inputs
- task_artifact_outputs
- decisions
- decision_impacts
- reviews
- permissions
- approval_requests
- context_manifests
- events
- outbox_events
- command_deduplication

Later experiment/memory tables are added when their slice begins.

## 7. Command path

Every mutation uses:

```text
Command Envelope
 -> schema validation
 -> org scope validation
 -> idempotency lookup
 -> aggregate load
 -> expected revision check
 -> Policy Engine
 -> domain invariant
 -> DB transaction
 -> revision increment
 -> event sequence
 -> Event
 -> Outbox
 -> dedup result
 -> COMMIT
```

## 8. Query/read path

Initial Query API:

```text
GET /v1/organizations/{orgId}
GET /v1/organizations/{orgId}/snapshot
GET /v1/organizations/{orgId}/goals
GET /v1/organizations/{orgId}/tasks
GET /v1/organizations/{orgId}/tasks/{taskId}
GET /v1/organizations/{orgId}/artifacts/{artifactId}/versions
GET /v1/organizations/{orgId}/decisions
GET /v1/organizations/{orgId}/events?after_sequence=...
GET /v1/organizations/{orgId}/approvals
```

Mutation gateway:

```text
POST /v1/organizations/{orgId}/commands
```

Live observer stream:

```text
GET /v1/organizations/{orgId}/events/stream?after_sequence=...
```

using SSE.

## 9. Implementation dependency graph

```text
E00 Repository Foundation
 |
E01 Protocol
 |
E02 Database
 |
E03 Domain Invariants
 |
E04 Command + Policy + Event/Outbox
 |
 +-------------------+
 |                   |
E05 Query/SSE       E06 Scheduler/Run/Lease
                     |
                  E07 Artifact/Impact
                     |
                  E08 Decision/Review/Reports
                     |
                  E09 Context Compiler
                     |
                  E10 Runtime Manager/Agent Adapter
                     |
                  E11 Workspace/Sandbox/MCP
                     |
                  E12 Software Company Template
                     |
                  E14 Scenario A
                     |
                  E15 Chaos
                     |
                  E16 Evaluation/Baselines
                     |
                  E17 Scenario B

E13 Observer UI begins after E05 and integrates progressively.
```

## 10. Execution slices

### Slice 0 — Deterministic Kernel

Epics: E00–E04.

Goal: prove authoritative organizational state and write-path correctness before involving a real model.

Exit conditions:

- create organization
- create role/membership/goal/task
- validate Task state transitions
- prevent dependency cycles
- policy allow/deny/approval
- revision conflicts work
- idempotency works
- event/state/outbox atomicity works

### Slice 1 — Coordination Engine

Epics: E05–E06.

Goal: make deterministic multi-worker coordination real.

Exit conditions:

- query organization state
- task DAG blocks/unblocks correctly
- scheduler safely claims READY work
- exactly one active lease per task
- lease expiration creates recoverable lost run
- SSE/reconciliation provide consistent observation

### Slice 2 — Organizational Truth

Epics: E07–E08.

Goal: make agents coordinate through durable outputs and decisions rather than chat.

Exit conditions:

- artifact versions immutable
- lineage and consumers tracked
- new breaking artifact version marks affected work
- decisions have authority and supersession
- QA review/rework controls completion
- reporting is computed from verified state

### Slice 3 — Intelligence Boundary

Epics: E09–E10.

Goal: connect the first real agent without allowing it to bypass the Kernel.

Exit conditions:

- Context Compiler creates exact Context Manifest
- required current decisions/artifacts are mandatory
- untrusted context cannot redefine authority
- one real CTO agent receives Work Contract
- CTO emits valid bounded AOP Commands to create/decompose tasks
- invalid commands are denied safely
- run/model/tool usage is traceable

### Slice 4 — Real Work Environment

Epics: E11–E13.

Goal: allow real coding work while a human can observe/control the company.

Exit conditions:

- isolated Git workspace per run
- sandbox has no Kernel DB credential
- bounded MCP/tool surface
- five-role Software Company template
- observer dashboard/org/task/artifact/decision/run/approval views
- kill-and-recover sandbox demonstration

### Slice 5 — Product PoC

Epics: E14–E15.

Goal: make the AI company build a small real product and survive controlled failures.

Primary scenario: URL shortener with authentication.

Required perturbations:

- breaking API spec change
- backend runtime/sandbox kill
- QA rejection/rework
- duplicate command injection
- tool/model timeout
- unauthorized action attempt

Exit conditions:

- final product tests pass
- no manual DB repair
- organization audit explains how output was created
- coordination invariants hold under chaos

### Slice 6 — Comparative Validation

Epics: E16–E17.

Goal: determine if AOP's extra coordination complexity is justified.

Run equivalent scenarios under:

- SINGLE_AGENT
- SUPERVISOR_MULTI_AGENT
- AOP_ORGANIZATION

Then introduce Scenario B: GitHub repository analyzer.

## 11. First executable engineering tickets

These are the first tickets to implement, in order.

### T0001 — Initialize monorepo

Create pnpm workspace, app/package directories, TypeScript configs, test/lint/build scripts.

Acceptance:

```text
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

all succeed on clean baseline.

### T0002 — Docker local dependencies

Create Docker Compose for PostgreSQL and MinIO/object store plus environment template.

Acceptance:

- health checks pass
- services start/stop repeatedly without manual state repair

### T0003 — Protocol IDs and Principal schemas

Implement ID types, Principal, ResourceRef, protocol version, shared validation helpers.

### T0004 — Organization/Agent/Membership/Role schemas

Runtime-validatable protocol types with fixtures.

### T0005 — Goal/Task/TaskRun/Lease schemas

Include state enums and Work Contract fields.

### T0006 — Artifact/Decision/Review/Permission/Approval schemas

Include immutable-version metadata and evidence structures.

### T0007 — Command/Event/ContextManifest envelopes

Add discriminated command/event bases, schema versioning, structured errors.

### T0008 — Database bootstrap and migration 0001

Create base extension/config and organizations/agents/memberships/roles/goals.

### T0009 — Migration 0002 task engine

Create tasks, dependencies, runs, leases and indexes/constraints.

### T0010 — Migration 0003 organizational truth

Artifacts, decisions, reviews, permissions, approvals, events/outbox/dedup/context manifests.

### T0011 — Organization/Goal domain services

Validated creation/update lifecycle and revision handling.

### T0012 — Task state machine

Allowed transitions, blocked reasons, review submission, terminal states.

### T0013 — Task DAG service

Add/remove hard dependencies with cycle prevention and readiness calculation.

### T0014 — Artifact/Decision/Review state machines

Deterministic lifecycle rules.

### T0015 — Policy Engine skeleton

Explicit Principal + capability resolution; initial role policy fixtures.

### T0016 — Command Gateway transaction skeleton

Implement parse -> idempotency -> revision -> policy -> domain -> event/outbox -> commit.

### T0017 — Command integration tests

Concurrency, idempotency, scope, policy, transaction atomicity.

### T0018 — Query snapshot API

Enough read surface for integration tests and initial observer.

### T0019 — Outbox worker

Claim/publish/process safe retry baseline.

### T0020 — Scheduler/readiness/lease

First deterministic coordination vertical slice.

These tickets complete the critical beginning of Slice 0 and enter Slice 1.

## 12. Required tests before first agent is connected

A real model/runtime must not be connected until these tests pass:

1. duplicate idempotency command -> one mutation
2. two concurrent stale revisions -> one wins, one conflict
3. cross-org reference -> denied
4. task DAG cycle -> denied
5. invalid Task transition -> denied
6. ordinary worker direct completion -> denied
7. permission self-grant -> denied
8. dual active lease -> impossible
9. event/state transaction failure -> neither partially persists
10. outbox retry -> no duplicate authoritative state

This protects the project from blaming LLM behavior for Kernel correctness bugs.

## 13. Runtime implementation contract

First runtime adapter must support:

- prepare
- start
- cancel
- inspect
- usage collection
- trace references

Runtime Manager must:

- create/restore workspace
- compile Context Manifest
- bind exact allowed capabilities
- start adapter
- maintain lease heartbeat
- normalize failure
- persist structured Run Report
- never permit adapter DB writes

## 14. Context Compiler v0.1

Implement resolvers in this order:

1. identity
2. role/authority
3. organization policy
4. goal
5. task
6. dependencies
7. active decisions
8. required artifacts
9. previous attempt
10. derived memory (minimal initially)
11. untrusted external evidence
12. capabilities/tools
13. token budget/assembler

Mandatory fragments cannot be dropped silently.

## 15. Memory v0.1 scope

Do not build a sophisticated memory product before the core organization works.

Initial implementation:

- Working memory: workspace/run report
- Episodic memory: evidence-backed run lesson records later in Slice 3/4
- Semantic retrieval: minimal adapter/interface, optional first implementation
- Organizational truth: always retrieved directly from authoritative state

## 16. Security minimum before external tools

- no DB credentials in sandbox
- secrets outside generated-code environment
- per-run capability binding
- workspace path isolation
- organization scope checks
- tool output treated as untrusted data
- sensitive logs redacted
- protected Git/deploy actions policy-gated
- short-lived/scoped external access where supported

## 17. Observer UI priority

Build in this order:

1. organization overview
2. task/goal graph
3. task inspector
4. event timeline
5. approval inbox
6. org chart
7. artifact registry
8. decision registry
9. run/context inspector

Do not block Kernel development on polished UI.

## 18. Experiment evidence model

Every experiment persists:

- source commit SHA
- AOP version
- scenario version
- organization template version
- agent/role versions
- resolved model/provider
- tool versions
- Context Manifest IDs
- failures injected
- token/cost/tool/runtime usage
- product test outputs
- organizational metrics
- evaluator version/output

## 19. Go/no-go gates

### Gate A — Kernel correctness

All deterministic invariants/concurrency tests pass.

### Gate B — Coordination/recovery

Task/run/lease/outbox recovery works without manual DB repair or duplicate accepted results.

### Gate C — Governance

Adversarial unauthorized actions are deterministically blocked.

### Gate D — Organizational coherence

Breaking authoritative changes are detected; known-stale work does not silently ship as valid.

### Gate E — Scenario completion

Software Company repeatedly completes Scenario A with machine-verifiable tests.

### Gate F — Comparative evidence

Benchmark reveals whether AOP improves correctness/autonomy/recovery enough to justify coordination cost.

Marketplace work does not start merely because UI/agents look impressive.

## 20. Marketplace unlock conditions

Agent Marketplace design moves into implementation only after:

- Organization Kernel passes deterministic gates
- at least one real company scenario completes reliably
- agent capabilities can be evaluated rather than self-claimed only
- runtime/provider boundaries have been tested
- evidence shows reusable teams/agents provide value

Then future epics may include:

- Agent Registry/Marketplace
- Skill Marketplace
- Agent evaluation cards
- Company templates
- hiring/HR agents
- reputation/performance graph
- paid workers/tools/knowledge packs
- company-to-company services

## 21. Architecture change process

Any implementation discovery that changes a frozen principle creates an ADR in `docs/adr/`.

ADR must record:

- context/evidence
- problem
- alternatives
- decision
- consequences
- compatibility/migration effects

Meetings should resume only for cross-cutting decisions, failed gates, or ADR-level changes.

## 22. Implementation handoff

Planning is complete.

The next valid project action is:

> **Start Slice 0 with T0001 — Initialize monorepo.**

Do not continue speculative architecture meetings unless implementation evidence exposes a real unresolved issue.

# AOP System Architecture v0.1

Status: Implementation baseline

Date: 2026-08-25

## Architecture objective

Build a persistent AI Organization OS in which intelligent workers can plan and execute work while deterministic software guarantees state consistency, authority, coordination, auditability, and recovery.

## Top-level architecture

```text
Human Founder
    |
Web / API Control Surface
    |
Organization Kernel
    |-- Command Gateway
    |-- Policy Engine
    |-- Goal/Task Domain
    |-- Artifact Registry
    |-- Decision Registry
    |-- Review Engine
    |-- Scheduler / Lease Manager
    |-- Approval Engine
    |-- Reporting Projection
    |
PostgreSQL authoritative state + Outbox
    |
Workers / Reconciliation
    |
Context Compiler
    |
Runtime Manager
    |
Agent Runtime Adapters
    |-- OpenAI/local provider adapter first
    |-- future provider adapters
    |-- A2A remote adapter
    |
Workspace + Sandbox
    |
MCP Tool Fabric / External Systems

S3-compatible Object Storage <-> Artifact Registry
Git worktrees/repositories <-> Coding Workspaces
OpenTelemetry/provider traces <-> Observability
```

## Architectural layers

### 1. Control Plane / Organization Kernel

Owns authoritative organizational coordination:

- organization and membership
- role and authority
- goals
- tasks and dependencies
- commands
- permissions/approvals
- decisions
- reviews
- leases/runs
- scheduling

The Kernel should contain as little domain intelligence as possible beyond organizational correctness.

### 2. Data Plane

Authoritative state:

- PostgreSQL
- artifact metadata
- decisions/reviews
- event log

Durable content:

- object storage
- Git
- workspace snapshots

Derived intelligence:

- full-text/vector memory indexes
- management projections
- evaluation aggregates

### 3. Intelligence Plane

- Context Compiler
- manager/worker agents
- model routing
- memory retrieval/curation
- impact analysis where semantic reasoning is needed

### 4. Execution Plane

- Runtime Manager
- provider adapters
- sandboxes
- workspaces
- MCP tools
- remote A2A workers

### 5. Observation/Evaluation Plane

- Query API
- SSE organization events
- Observer web UI
- traces/logs/metrics
- experiment/benchmark harness

## Central write path

```text
Principal
   |
AOP Command
   |
Schema validation
   |
Scope / idempotency / revision
   |
Policy Engine
   |
Domain invariant
   |
PostgreSQL transaction
   |-- state mutation
   |-- revision increment
   |-- event sequence
   |-- event
   `-- outbox
   |
commit
```

No agent or controller bypasses this path for authoritative writes.

## Asynchronous path

```text
Outbox
  |
Worker claim
  |
Idempotent consumer
  |-- scheduler
  |-- runtime start
  |-- impact analysis
  |-- readiness reconciliation
  |-- reports
  `-- notifications/UI invalidation
```

Events are the fast path. Database reconciliation is the correctness fallback.

## Runtime path

```text
Task READY
  |
Scheduler
  |
TaskRun + Lease
  |
Runtime Manager
  |-- prepare durable workspace
  |-- compile Context Manifest
  |-- resolve effective capabilities
  |-- create sandbox
  `-- start runtime adapter
       |
      Agent
       |-- AOP command tools
       |-- MCP capabilities
       |-- workspace edits
       `-- artifact production
  |
Run report
  |
Task submit for review
```

## Recovery path

```text
Sandbox/runtime loss
   |
lease expiry / runtime reconciliation
   |
mark TaskRun LOST
   |
inspect durable workspace/artifacts/checkpoint
   |
create next TaskRun
   |
compile fresh current authoritative context
   |
rehydrate workspace into new sandbox
   |
resume task work
```

Organization state does not depend on the survival of a model request or sandbox container.

## Context architecture

Context is compiled, never equated with full conversation history.

Resolver pipeline:

```text
Identity
 -> Role/Authority
 -> Goal
 -> Task
 -> Dependencies
 -> Active Decisions
 -> Required Artifacts
 -> Previous Attempt
 -> Derived Memory
 -> External Evidence
 -> Effective Capabilities
 -> Context Budget/Assembler
```

Every run persists a Context Manifest referencing exact authoritative versions.

## Memory architecture

```text
Authoritative truth (not derived memory)
  goals/tasks/decisions/artifacts/reviews/events

Working memory
  run-local notes

Episodic memory
  evidence-backed lessons

Semantic/knowledge memory
  searchable derived knowledge
```

Derived memory may inform reasoning but cannot override authoritative state.

## Security architecture

### Trust boundaries

1. browser/human client
2. Kernel/API
3. database/object storage
4. background worker
5. agent runtime
6. sandbox/generated code
7. MCP/external tool
8. remote A2A agent

### Security rules

- organization is the tenancy boundary for v0.1
- every mutation carries explicit Principal
- authorization is deterministic
- sandbox receives no Kernel DB credential
- long-lived secrets remain outside generated-code environments
- capabilities/tools are bound per run
- external content is untrusted context
- cross-org references are denied
- artifact checksums/provenance are validated
- protected branch/deployment operations are policy gated
- security outcomes are tested adversarially

## Deployment topology

PoC processes:

```text
web
api
worker
sandbox-runner
postgres
object-store
```

API and worker can scale horizontally only where DB constraints/idempotency preserve correctness. No correctness rule depends on a single-process deployment.

## Local development

Docker Compose provides PostgreSQL and S3-compatible object storage plus application services. Sandbox implementation is behind an adapter and may run locally/containerized first.

## Interfaces

### Public/internal HTTP

- Command Gateway for side effects
- Query API for reads
- SSE for organization event updates

### Runtime interface

- prepare/start/resume/cancel/inspect
- usage/trace collection

### Tool interface

- MCP adapters/capabilities

### Remote agent interface

- A2A adapter

## Observability

Three correlated layers:

1. infrastructure trace
2. runtime/agent trace
3. organization trace

Core correlation keys:

- organization_id
- goal_id
- task_id
- task_run_id
- membership_id
- command_id
- event_id
- context_manifest_id
- trace_id

## Architecture non-goals for v0.1

- microservices
- Kubernetes requirement
- Kafka requirement
- graph database requirement
- public marketplace
- billing/reputation economy
- unrestricted agent-to-agent group chat as coordination architecture
- provider-specific Organization Kernel

## Architecture freeze rule

Implementation evidence may change this architecture only through an ADR describing:

- problem/evidence
- alternatives
- chosen change
- consequences
- migration/compatibility impact

The architecture is a baseline to test, not a doctrine to preserve against evidence.

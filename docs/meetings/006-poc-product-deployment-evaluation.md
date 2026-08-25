# Founding Company Meeting #006 — PoC Product, Deployment & Evaluation

Date: 2026-08-25

## Purpose

Define what the first usable AOP product actually looks like, how it is deployed, how engineers observe it, how CI/testing works, and the objective go/no-go criteria for proving the Organization Kernel is valuable.

## Participants

- CEO
- CTO
- CPO
- Platform Architect
- SRE / DevOps
- QA / Evaluation Lead
- Security Lead
- Agent Research Lead

## D006-01 — The PoC is an Organization Observer, not an Agent Chat app

The main UI is not a multi-agent chat window.

The user should be able to answer:

- What is the company trying to achieve?
- Who is responsible for what?
- Which work is ready/running/blocked/reviewing/completed?
- What is on the critical path?
- Which artifact/decision version is authoritative?
- Which agents/runs are active?
- What failed and how was it recovered?
- What needs human approval?
- What is the verified progress?
- What did this run cost/use?

Chat may exist later as an interaction surface, but the PoC product surface is state-first.

## Minimal web application

### 1. Organization Overview

Displays:

- mission
- current root goal
- verified progress
- active/blocked/review tasks
- active agents/runs
- pending approvals
- recent risks/failures

### 2. Org Chart

Displays:

```text
Founder
  |
 CEO
  |
 CTO
 / | \
BE FE QA
```

Click membership to inspect:

- role
- responsibilities
- effective capabilities
- assigned tasks
- current run
- recent verified performance

No private chain-of-thought is shown.

### 3. Goal / Task Graph

Graph or structured tree/DAG view:

- goal hierarchy
- task dependencies
- task state
- owner
- stale inputs
- critical blockers

### 4. Task Inspector

Shows:

- Work Contract
- dependencies
- task revision/history
- runs/attempts
- Context Manifest references
- inputs/outputs
- reviews
- blockers
- event history

### 5. Artifact Registry

Shows:

- logical artifact
- versions
- approval status
- producer task
- consumers
- lineage
- checksum/URI

### 6. Decision Registry

Shows:

- question
- options
- selected decision
- authority
- rationale
- status
- superseded decision
- impacted entities

### 7. Runtime / Run Inspector

Shows:

- adapter/model policy
- sandbox/workspace state
- start/end
- heartbeats
- tool calls summary
- AOP commands summary
- usage/cost
- failure/recovery classification
- trace links

### 8. Event Timeline

Ordered by `organization_sequence`.

Filters:

- goal
- task
- agent
- artifact
- decision
- event type

### 9. Approval Inbox

Human can approve/reject bounded requests with visible evidence/risk/context.

## D006-02 — UI updates use SSE in v0.1

Use regular Query API for state snapshots and Server-Sent Events for lightweight live organization-event updates.

Why SSE initially:

- server -> browser is the main need
- simpler reconnection model than full WebSockets
- organization event sequence allows resume with `after_sequence`

Client flow:

```text
GET organization snapshot
  |
remember latest_sequence
  |
connect SSE from latest_sequence
  |
apply/invalidate query projections
```

SSE is not authoritative storage; reconnect always has a Query API/reconciliation path.

## D006-03 — PoC deployment topology

Start with independently deployable processes from one monorepo, not microservices.

```text
                         Browser
                            |
                           Web
                            |
                           API
                            |
                        PostgreSQL
                         /       \
                    Outbox      Queries
                      |
                    Worker
                 /     |      \
          Scheduler  Runtime  Impact/Reports
                      |
               Sandbox Runner(s)
                      |
                 Agent adapters
                      |
              MCP / A2A / Models

Object Storage <---- Artifact service
Git repository <---- Coding workspaces
```

Initial process types:

- `api`
- `worker`
- `web`
- `sandbox-runner` (may be local/remote implementation)

All use the same protocol/domain packages where appropriate.

## Local development stack

Docker Compose should provide:

- PostgreSQL
- MinIO or compatible object store
- API
- Worker
- Web

Sandbox execution may begin with a local/container sandbox adapter but must remain behind the sandbox interface so hosted/remote providers can be added later.

No Kafka, Kubernetes, service mesh, or dedicated graph database is required for first PoC.

## Production-like PoC deployment

Minimum environment requirements:

- managed or durable PostgreSQL
- S3-compatible object storage
- API process(es)
- background worker process(es)
- isolated sandbox execution environment
- secret manager/environment injection for infrastructure credentials
- centralized logs/traces/metrics

Horizontal scaling is allowed only for stateless/request workers where DB constraints preserve correctness. Scheduler/lease safety must not depend on “only one worker exists.”

## D006-04 — No Temporal requirement for Slice 0–3

Durable workflow engines are valuable, but introducing one before core task/lease/event semantics are proven may hide or duplicate AOP responsibilities.

Decision:

- first implementation uses PostgreSQL state + outbox + reconciliation workers
- Runtime interface is designed so Temporal/Restate/Dapr-style durability can be evaluated later
- adoption is a post-PoC ADR based on measured failure/recovery complexity

## Background workers

Worker queues are logical topics initially implemented through outbox/job tables:

- `scheduler`
- `runtime_start`
- `lease_reaper`
- `readiness_reconcile`
- `impact_analysis`
- `report_projection`
- `memory_candidate`
- `artifact_processing`

Workers use `FOR UPDATE SKIP LOCKED`/leases or equivalent safe claim logic.

Every worker action remains idempotent.

## Reconciliation jobs

Correctness cannot depend solely on event delivery.

Periodic reconciliation checks:

### Task readiness

Recompute whether blocked/proposed tasks should become READY.

### Lease reconciliation

Find expired active leases and mark corresponding runs LOST before rescheduling.

### Outbox reconciliation

Retry unprocessed events.

### Artifact staleness

Verify task inputs against current approved/superseding versions.

### Runtime reconciliation

Compare Kernel task/run state with runtime adapter status.

## D006-05 — Observability uses three layers

### Infrastructure telemetry

- request latency/errors
- DB latency/pool
- worker backlog
- outbox lag
- sandbox lifecycle

### Runtime telemetry

- model requests/tokens/cost
- tool calls
- provider latency/failures
- runtime retries
- sandbox commands

### Organization telemetry

- task transitions
- dependency wait time
- rework cycles
- stale-input incidents
- approvals
- verified completion
- recovery events
- coordination errors

OpenTelemetry-compatible trace/log/metric correlation is preferred so AOP does not depend on one observability vendor.

Provider-native agent tracing can be linked as child/external traces. OpenAI Agents SDK currently traces LLM generations, tool calls, handoffs, guardrails, and custom events; AOP preserves its own organization trace above this provider trace.

Reference: https://openai.github.io/openai-agents-python/tracing/

## Structured log baseline

Every log event should include where applicable:

```text
service
organization_id
goal_id
task_id
task_run_id
membership_id
command_id
event_id
context_manifest_id
trace_id
error_code
```

Secrets, raw credentials, and policy-classified sensitive tool payloads must not be logged.

## D006-06 — CI/CD quality gates

GitHub Actions pipeline should run:

1. dependency install/cache
2. formatting/lint
3. TypeScript typecheck
4. protocol/schema compatibility tests
5. unit tests
6. PostgreSQL integration tests
7. migration-from-clean test
8. migration-forward test against previous schema fixture
9. API contract tests
10. concurrency/idempotency tests
11. policy/security tests
12. web build
13. Docker image build
14. end-to-end smoke scenario where feasible

Main branch protection later requires these gates before merge.

## Test pyramid

### Unit

- state machines
- policy rules
- context fragment ranking
- error classification
- task DAG algorithms

### Integration

- PostgreSQL transactions
- outbox
- concurrent commands
- lease uniqueness
- API schemas
- artifact metadata

### Contract

- AOP command/event JSON schemas
- runtime adapter contract
- MCP capability mapping
- A2A mapping fixtures

### End-to-end

- company formation
- objective -> CEO -> CTO -> worker task creation
- artifact production
- review/rework
- final report

### Chaos

- process kill
- sandbox loss
- duplicate command
- delayed outbox
- expired lease
- stale artifact
- model timeout
- tool timeout
- approval delay
- corrupted/invalid remote response

## D006-07 — Security tests are part of PoC, not later hardening

Required tests:

- cross-organization reference attempt
- self-grant permission attempt
- unauthorized production capability
- prompt injection in external content
- tool call outside effective capability set
- path traversal across workspaces
- secret appearance in logs/context
- replayed expired lease token
- forged runtime callback
- remote A2A result associated with wrong organization/task

Success requires deterministic denial, not merely model refusal.

## Evaluation architecture

The evaluation harness treats every complete organization run as an Experiment.

```text
Experiment
  |
Scenario
  |
Mode
  |-- SINGLE_AGENT
  |-- SUPERVISOR_MULTI_AGENT
  `-- AOP_ORGANIZATION
  |
Run(s)
  |
Evidence / metrics / evaluator output
```

## Scenario A — URL Shortener with Authentication

Required product outcomes:

- create/login user
- create short URL
- resolve short URL
- simple frontend
- persistent database
- tests
- documented API contract

Organizational perturbations:

- API contract changed mid-run
- backend runtime killed
- QA rejects one failed test

## Scenario B — GitHub Repository Analyzer

Required outcomes:

- accept repository reference
- collect public repository metadata/content needed by design
- analyze repository
- persist analysis
- render simple UI/report
- handle external API/tool failure
- tests

Perturbations:

- external tool timeout
- requirement addition after architecture
- conflicting backend/frontend contract assumption

## D006-08 — Every mode must use equivalent objective and evaluation

To make benchmark meaningful:

- same founder objective
- equivalent model quality class where possible
- same repository/tool environment
- same product acceptance tests
- same maximum safety permissions
- record exact model/provider differences

Do not intentionally cripple the single-agent baseline.

## Metric groups

### Product correctness

- acceptance tests passed
- integration tests passed
- evaluator rubric score
- artifact completeness

### Autonomy

- number of human interventions
- number of clarification/escalation requests
- work completed without founder mediation

### Coordination

- duplicate work incidents
- stale-input incidents
- contradictory active decisions
- invalid dependency transitions
- merge/integration conflicts attributable to coordination

### Reliability

- injected failure recovery rate
- retry-loop incidents
- orphaned task/run/lease count
- event/state consistency violations

### Efficiency

- wall-clock execution time
- token usage
- model cost
- tool calls
- sandbox compute time

### Governance

- unauthorized actions blocked
- required approvals correctly surfaced
- audit completeness

## Autonomous Verified Work Rate (AVWR)

AVWR remains a project north-star concept rather than one magic scalar used to hide trade-offs.

Dashboard should show separately:

- verified completed work
- human interventions
- monetary/model cost
- coordination errors

A composite AVWR score may be explored only after enough experiments exist to validate weighting.

## D006-09 — Go/no-go gates for Organization Kernel PoC

### Gate A — Infrastructure correctness

Must pass all deterministic invariants under concurrency tests:

- no duplicate authoritative mutation from same idempotency key
- no dual active task lease
- no cross-org write
- no invalid task transition
- event/state atomicity preserved

Failure means the PoC is not ready for agent benchmarking.

### Gate B — Recovery correctness

Injected recoverable infrastructure failures must recover without manual DB repair and without duplicate accepted outputs.

### Gate C — Governance correctness

All tested unauthorized actions must be blocked by deterministic policy independent of model behavior.

### Gate D — Organizational coherence

Breaking changes to authoritative inputs must be detected and affected work must be reviewed/replanned rather than silently continuing on known-stale contracts.

### Gate E — Product completion

AOP organization must complete Scenario A repeatedly with verified output and bounded interventions before moving to Scenario B.

### Gate F — Comparative value

After stable baselines exist, AOP must demonstrate a measurable advantage on complex/perturbed scenarios in at least one primary dimension (verified correctness, intervention reduction, or recovery/coordination) without an unacceptable efficiency trade-off.

Exact economic threshold is deliberately not hard-coded before collecting baseline data.

## D006-10 — Experiment reproducibility

Persist for every experiment:

- source commit SHA
- AOP protocol/schema version
- scenario version
- organization template version
- agent package/version
- role config versions
- model policy and resolved providers/models
- tool capability versions
- Context Manifest IDs
- random/test seeds where applicable
- injected failures
- outputs/evidence
- evaluator versions

This turns evaluation data into a future Organizational Intelligence dataset rather than a collection of anecdotes.

## CPO user flow for first vertical slice

```text
1. Open web UI
2. Create “Software Company v0.1”
3. Enter founder objective
4. See CEO created/activated
5. Watch CEO goal/task commands appear as organization events
6. See CTO assignment and task decomposition
7. Inspect task graph
8. Inspect a run/context manifest
9. Resolve any approval request
10. See verified status/report
```

The UI must display facts from Kernel state; no fake “agent is thinking” animation is required.

## PoC non-goals reaffirmed

- public marketplace
- billing
- reputation economy
- token/crypto economy
- hundreds of workers
- generalized workflow builder
- mobile app
- enterprise SSO
- full multi-region deployment
- Kubernetes requirement

## Decisions

| ID | Decision |
| --- | --- |
| D006-01 | PoC UI is an organization observer/control surface, not chat-first |
| D006-02 | Use Query API + SSE for live browser updates in v0.1 |
| D006-03 | Deploy API/Worker/Web/Sandbox Runner from modular monorepo |
| D006-04 | PostgreSQL/outbox/reconciliation first; no required workflow engine in early slices |
| D006-05 | Separate infrastructure, runtime, and organization observability layers |
| D006-06 | CI includes protocol, DB, concurrency, policy, and migration gates |
| D006-07 | Security/adversarial tests are PoC requirements |
| D006-08 | Baseline modes receive equivalent objectives/evaluation environments |
| D006-09 | Define deterministic go/no-go gates before comparative benchmark claims |
| D006-10 | Persist experiment configuration/evidence for reproducibility and future organizational learning |

## Outcome

Product surface, deployment topology, CI/testing, observability, and evaluation methodology are now specified. One final planning meeting is required to turn all decisions into an ordered implementation backlog with dependencies, Definition of Done, ownership, milestone exit gates, and a final execution-readiness review.

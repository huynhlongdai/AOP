# Founding Company Meeting #004 — Domain Model, Database & Command API

Date: 2026-08-25

## Purpose

Close the remaining ambiguity around the authoritative data model and the API boundary between humans, agents, runtimes, and the Organization Kernel.

## Participants

- CTO
- Platform Architect
- Data Architect
- Security Architect
- API Architect
- Agent Runtime Engineer
- QA/SRE

## D004-01 — Kernel owns organizational state

A2A and MCP are interoperability layers, not the system of record for AOP organizations.

Current standards reinforce this boundary:

- A2A 1.0 defines interoperable Task, Message, Artifact, Agent Card, and remote-agent interaction.
- MCP 2026-07-28 uses a stateless protocol core and explicitly allows applications to carry state through explicit handles.

Therefore:

> Organization, Goal, Role, Task, Decision, Review, Lease, Permission, and authoritative Artifact metadata live under the AOP Kernel.

References:
- https://a2a-protocol.org/dev/specification/
- https://blog.modelcontextprotocol.io/posts/2026-07-28/

## D004-02 — Technology baseline

PoC backend baseline:

- TypeScript
- Node.js current LTS
- Fastify HTTP server
- PostgreSQL
- Drizzle ORM + explicit SQL migrations
- Zod/JSON Schema for command and protocol validation
- S3-compatible object storage for binary/large artifacts
- Git for source artifacts
- PostgreSQL outbox before introducing Kafka/NATS

The exact implementation libraries remain replaceable behind packages; AOP protocol types may not import Fastify, Drizzle, or provider SDKs.

## D004-03 — IDs and ordering

Use application-generated time-sortable UUIDs (UUIDv7 preferred) stored in PostgreSQL UUID columns.

Why:

- distributed creation without central sequence allocation
- index locality better than fully random UUIDs
- standard identifier type

Organization events additionally carry a monotonically increasing `organization_sequence` allocated transactionally per organization. UUID timestamp ordering does not replace the authoritative event sequence.

## D004-04 — Multi-tenancy boundary

Every organization-owned table carries `organization_id` either directly or through an unambiguous parent relation.

Rules:

1. Every command declares `organization_id`.
2. Every aggregate load is scoped by organization.
3. Cross-organization references are rejected unless using an explicit federation/external-contract primitive in a future version.
4. PostgreSQL Row-Level Security may be added as defense-in-depth, but application authorization remains mandatory.
5. Agent credentials are scoped to one organization membership unless explicitly federated.

## Aggregate boundaries

### Organization Aggregate

Owns:

- organization identity
- mission/status
- governance configuration
- global revision

Does not directly embed all agents/tasks as JSON.

### Agent Membership / Role Assignment Aggregate

Separates global agent identity from organization membership.

Recommended model:

```text
agents
  id
  canonical_name
  runtime_profile
  capability_claims

organization_memberships
  id
  organization_id
  agent_id
  status
  manager_membership_id

roles
role_assignments
```

This allows one marketplace agent identity to be hired into multiple organizations later without merging company-specific state.

### Goal Aggregate

Goals form a tree through `parent_goal_id`.

### Task Aggregate

Task is the central mutable work contract. Dependencies, artifact references, runs, and reviews are related records but task state changes occur only through Task Domain Service.

### Artifact Aggregate

`artifacts` identifies the logical artifact; `artifact_versions` identifies immutable versions.

### Decision Aggregate

A decision may be superseded but never silently overwritten/deleted from history.

## PostgreSQL schema v0.1

### organizations

```text
id uuid pk
name text
slug text
status text
mission text
owner_type text
owner_id text
settings jsonb
revision bigint
created_at timestamptz
updated_at timestamptz
```

Unique indexes:

- `(slug)` initially global for PoC

### agents

```text
id uuid pk
name text
version text
runtime_profile jsonb
capabilities jsonb
metadata jsonb
created_at timestamptz
```

Capability claims remain claims until backed by evaluation/reputation in later versions.

### organization_memberships

```text
id uuid pk
organization_id uuid fk
agent_id uuid fk
status text
manager_membership_id uuid nullable
joined_at timestamptz
left_at timestamptz nullable
revision bigint
```

Unique active membership constraint for `(organization_id, agent_id)` in PoC.

### roles

```text
id uuid pk
organization_id uuid fk
name text
purpose text
authority_policy jsonb
responsibilities jsonb
prohibitions jsonb
revision bigint
```

### role_assignments

```text
id uuid pk
organization_id uuid fk
membership_id uuid fk
role_id uuid fk
active boolean
assigned_by text
assigned_at timestamptz
revoked_at timestamptz nullable
```

### goals

```text
id uuid pk
organization_id uuid fk
parent_goal_id uuid nullable
owner_membership_id uuid nullable
title text
objective text
success_criteria jsonb
priority text
status text
revision bigint
created_at timestamptz
updated_at timestamptz
```

### tasks

```text
id uuid pk
organization_id uuid fk
goal_id uuid fk
parent_task_id uuid nullable
created_by_principal jsonb
owner_membership_id uuid nullable
reviewer_membership_id uuid nullable
title text
objective text
status text
priority text
scope jsonb
constraints jsonb
acceptance jsonb
blocked_reason jsonb nullable
revision bigint
created_at timestamptz
updated_at timestamptz
completed_at timestamptz nullable
```

Important indexes:

- `(organization_id, status, priority)`
- `(organization_id, owner_membership_id, status)`
- `(goal_id, status)`

### task_dependencies

```text
task_id uuid fk
depends_on_task_id uuid fk
dependency_type text
created_at timestamptz
primary key(task_id, depends_on_task_id)
```

Constraints:

- task cannot depend on itself
- both tasks must belong to same organization in v0.1
- cycle detection occurs in domain service before insert

### task_runs

```text
id uuid pk
organization_id uuid fk
task_id uuid fk
membership_id uuid fk
attempt integer
status text
runtime_adapter text
runtime_run_id text nullable
workspace_id text nullable
snapshot_id text nullable
context_manifest_id uuid nullable
started_at timestamptz nullable
heartbeat_at timestamptz nullable
finished_at timestamptz nullable
failure_code text nullable
failure_detail jsonb nullable
created_at timestamptz
```

Unique `(task_id, attempt)`.

### leases

```text
id uuid pk
organization_id uuid fk
task_id uuid fk
task_run_id uuid fk
membership_id uuid fk
execution_token_hash text
acquired_at timestamptz
heartbeat_at timestamptz
expires_at timestamptz
released_at timestamptz nullable
status text
```

Only one ACTIVE lease per task enforced through a partial unique index.

### artifacts

```text
id uuid pk
organization_id uuid fk
logical_name text
type text
created_at timestamptz
```

### artifact_versions

```text
id uuid pk
organization_id uuid fk
artifact_id uuid fk
version integer
status text
uri text
mime_type text
schema_type text nullable
checksum text
size_bytes bigint nullable
created_by_principal jsonb
produced_by_task_id uuid nullable
supersedes_version_id uuid nullable
metadata jsonb
created_at timestamptz
```

Unique `(artifact_id, version)`.

Artifact version content is immutable once committed.

### artifact_lineage

```text
source_version_id uuid
target_version_id uuid
relation text
primary key(source_version_id, target_version_id, relation)
```

Examples: `derived_from`, `implements`, `tests`, `documents`.

### task_artifact_inputs

```text
task_id uuid
artifact_version_id uuid
required boolean
consumption_status text
primary key(task_id, artifact_version_id)
```

`consumption_status`: current / stale / waived.

### task_artifact_outputs

```text
task_id uuid
artifact_version_id uuid
primary key(task_id, artifact_version_id)
```

### decisions

```text
id uuid pk
organization_id uuid fk
scope text
question text
proposals jsonb
selected jsonb nullable
rationale text nullable
authority_principal jsonb nullable
status text
supersedes_decision_id uuid nullable
revision bigint
effective_at timestamptz nullable
created_at timestamptz
updated_at timestamptz
```

### decision_impacts

```text
decision_id uuid
entity_type text
entity_id uuid
relation text
primary key(decision_id, entity_type, entity_id, relation)
```

### reviews

```text
id uuid pk
organization_id uuid fk
subject_type text
subject_id uuid
reviewer_membership_id uuid
status text
policy jsonb
criteria jsonb
evidence jsonb
findings jsonb
result text nullable
revision bigint
created_at timestamptz
updated_at timestamptz
```

### permissions

PoC stores effective grants/policies separately from role policy definitions.

```text
id uuid pk
organization_id uuid fk
principal_type text
principal_id uuid
resource_type text
resource_pattern text
capability text
effect text
conditions jsonb
expires_at timestamptz nullable
created_at timestamptz
```

### approval_requests

```text
id uuid pk
organization_id uuid fk
source_command_id uuid
requested_by_principal jsonb
type text
payload jsonb
risk_level text
status text
resolved_by_principal jsonb nullable
expires_at timestamptz nullable
created_at timestamptz
resolved_at timestamptz nullable
```

### context_manifests

```text
id uuid pk
organization_id uuid fk
task_run_id uuid
agent_id uuid
task_id uuid
task_revision bigint
manifest jsonb
content_hash text
compiled_at timestamptz
```

### command_deduplication

```text
organization_id uuid
idempotency_key text
command_type text
command_id uuid
result_status text
result_payload jsonb
created_at timestamptz
primary key(organization_id, idempotency_key)
```

### events

```text
id uuid pk
organization_id uuid
organization_sequence bigint
type text
aggregate_type text
aggregate_id uuid
aggregate_revision bigint nullable
actor jsonb
causation_id uuid nullable
correlation_id uuid nullable
payload jsonb
occurred_at timestamptz
```

Unique `(organization_id, organization_sequence)`.

### outbox_events

```text
id uuid pk
organization_id uuid
event_id uuid
payload jsonb
available_at timestamptz
attempts integer
locked_at timestamptz nullable
processed_at timestamptz nullable
last_error text nullable
created_at timestamptz
```

## JSONB policy

JSONB is allowed for flexible domain payloads such as scope, acceptance criteria, capabilities, and settings.

However:

> Relations needed for correctness, concurrency, permissions, dependencies, artifact lineage, scheduling, or frequent queries must be normalized.

Do not hide task dependencies, ownership, active lease, or artifact consumption relationships inside JSONB.

## D004-05 — Separate Command API from Query API

The Kernel uses a CQRS-like logical separation without building a full event-sourced CQRS platform.

### Command Gateway

Agents/runtimes submit validated commands through one canonical gateway:

```text
POST /v1/organizations/{orgId}/commands
```

Body uses the AOP Command Envelope.

Advantages:

- consistent authorization
- idempotency
- revision checks
- audit/causation
- easy runtime tool wrapper
- command schema registry

Human UI may also use convenience endpoints that internally construct commands, but no controller may bypass the command/domain path.

### Query API

Examples:

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

Query endpoints never produce side effects.

## Command registry v0.1

Commands are discriminated by `type` and validated with a schema registry.

### Organization

- `organization.pause`
- `organization.resume`

### Membership / role

- `member.join`
- `member.suspend`
- `member.leave`
- `role.assign`
- `role.revoke`

### Goals

- `goal.create`
- `goal.update`
- `goal.complete`
- `goal.cancel`

### Tasks

- `task.create`
- `task.assign`
- `task.mark_ready`
- `task.start`
- `task.block`
- `task.unblock`
- `task.submit_review`
- `task.request_rework`
- `task.complete`
- `task.fail`
- `task.cancel`

Note: `task.complete` is only valid for trusted Review/Kernel workflow principals after acceptance validation. Ordinary workers use `task.submit_review`.

### Artifacts

- `artifact.create`
- `artifact.publish_version`
- `artifact.approve_version`
- `artifact.supersede_version`

### Decisions

- `decision.propose`
- `decision.approve`
- `decision.reject`
- `decision.supersede`

### Reviews

- `review.start`
- `review.submit`

### Lease/run

- `run.create`
- `lease.acquire`
- `lease.heartbeat`
- `lease.release`
- `run.fail`

These are primarily trusted Scheduler/Runtime Manager commands rather than arbitrary worker tools.

### Approval

- `approval.approve`
- `approval.reject`

## Command execution transaction

Canonical transaction sequence:

```text
1. Parse envelope
2. Validate schema
3. Verify organization scope
4. Check idempotency record
5. Load aggregate(s)
6. Verify expected revision
7. Policy authorize
8. Validate domain invariants
9. Mutate authoritative tables
10. Increment aggregate revision(s)
11. Allocate organization_sequence
12. Insert domain event(s)
13. Insert outbox event(s)
14. Store command result/dedup record
15. COMMIT
```

No notification, model call, vector embedding, or external network action occurs inside the database transaction.

## Error model

All command failures use machine-readable errors:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Task revision changed",
    "retryable": true,
    "details": {
      "expected": 7,
      "actual": 8
    }
  }
}
```

Initial error codes:

- VALIDATION_ERROR
- ORGANIZATION_SCOPE_VIOLATION
- NOT_FOUND
- REVISION_CONFLICT
- IDEMPOTENCY_CONFLICT
- POLICY_DENIED
- APPROVAL_REQUIRED
- INVALID_STATE_TRANSITION
- DEPENDENCY_UNSATISFIED
- TASK_GRAPH_CYCLE
- LEASE_CONFLICT
- STALE_INPUT
- CAPABILITY_MISMATCH
- RATE_LIMITED
- INTERNAL_ERROR

Retryability must be explicit.

## D004-06 — Dependency cycle protection

The task graph must remain a DAG for hard dependencies in v0.1.

On insertion of `A depends_on B`, the Task Domain Service checks whether B already reaches A. If so, command fails with `TASK_GRAPH_CYCLE`.

Soft/informational links may form non-blocking graph relationships but are excluded from scheduler readiness.

## D004-07 — Transactional readiness projection

Task readiness should not be stored as arbitrary agent judgment.

A task becomes READY only when deterministic conditions hold:

- task is accepted/proposed for execution
- all hard dependencies are completed/waived
- required authoritative inputs exist and are not blocked by stale-breaking status
- owner may be null until scheduling depending on workflow
- organization is active

Readiness transitions can be triggered by event consumers, but reconciliation recomputes them from authoritative state.

## D004-08 — Security principals

Every command actor is a Principal:

```text
human
agent_membership
system_scheduler
system_runtime_manager
system_review_engine
external_agent
service
```

System principals are explicit identities with narrowly scoped capability. “Internal service” is not an implicit superuser.

## D004-09 — Secret handling

Secrets never enter agent prompt/context as raw long-lived credentials unless a specific connector requires a short-lived secret and policy explicitly permits it.

Preferred pattern:

```text
Agent -> capability/tool call -> broker/runtime -> secret-backed external service
```

Audit records the capability invocation, not the secret value.

## D004-10 — Protocol versioning

Every external AOP command/query payload that may be consumed by independent clients carries/negotiates a protocol version.

Initial header:

```text
AOP-Version: 0.1
```

Rules:

- additive optional fields are backward compatible inside a minor line where possible
- semantic/state-machine changes require explicit version handling
- adapters declare supported AOP versions
- stored events retain their original event schema version

## Acceptance tests from Meeting #004

1. Two simultaneous commands with the same expected revision: exactly one succeeds.
2. Retrying the same idempotency key returns the original result without duplicate mutation.
3. Cross-organization task reference is rejected.
4. Attempting to insert a hard-dependency cycle is rejected.
5. Two schedulers cannot create two active leases for one task.
6. Worker attempting direct completion without review is rejected.
7. Agent without capability receives POLICY_DENIED.
8. Approval-required action creates a durable Approval Request rather than blocking an HTTP request indefinitely.
9. Artifact version cannot be modified after commit.
10. Event and state mutation either commit together or neither commits.

## Decisions

| ID | Decision |
| --- | --- |
| D004-01 | Kernel owns organization state; A2A/MCP remain interoperability layers |
| D004-02 | TypeScript + Fastify + PostgreSQL baseline, with replaceable packages |
| D004-03 | Time-sortable UUIDs plus per-organization event sequence |
| D004-04 | Organization is the strict tenancy/security boundary in v0.1 |
| D004-05 | Separate Command Gateway from side-effect-free Query API |
| D004-06 | Hard task dependencies form a DAG and are cycle-checked |
| D004-07 | Task readiness is deterministic and reconciled from authoritative state |
| D004-08 | Human, agent, and system actors are explicit Principals |
| D004-09 | Agents receive capabilities rather than long-lived raw secrets |
| D004-10 | AOP has explicit protocol/event schema versioning from the start |

## Outcome

The authoritative schema and command boundary are now sufficiently specific for implementation. The next meeting must define the runtime orchestration loop, workspace/sandbox lifecycle, context/memory pipeline, failure semantics, and how a real agent actually performs bounded work against this Kernel.

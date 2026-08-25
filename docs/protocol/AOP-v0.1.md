# Agent Organization Protocol (AOP) v0.1

Status: **PoC Specification / Implementation Baseline**

Date: 2026-08-25

## 1. Purpose

AOP defines organizational semantics for persistent AI workforces. It does not define how an LLM reasons and it does not replace agent/tool transport protocols.

AOP exists to make multiple AI workers coordinate through authoritative state, bounded authority, durable work contracts, artifacts, decisions, reviews, and events.

## 2. Design principles

1. **Dumb Kernel, Smart Agents.**
2. **Shared truth, selective memory.**
3. Agent runtime is disposable; organization state is durable.
4. Messages are communication, not authoritative state.
5. Work outputs become versioned Artifacts.
6. Organizational choices become Decisions.
7. Every authoritative mutation goes through a Command.
8. Every committed mutation emits an Event.
9. Authority comes from Role + Policy, not from model reasoning.
10. Context is compiled per run from authoritative state.
11. External effects require explicit capabilities.
12. Task completion is verified, not self-declared.

## 3. Interoperability position

```text
AOP
  organization / roles / authority / goals / tasks / decisions / reviews
       |
      A2A
  remote agent interoperability
       |
     Agent
       |
      MCP
  tools / data / external capabilities
```

AOP owns the organization state. A2A and MCP adapters are replaceable boundaries.

## 4. Core primitives

### Organization

Persistent root entity containing mission, governance settings, owner, status, and revision.

### Agent

Durable worker identity/capability profile. Agent is distinct from organization membership and runtime process.

### Organization Membership

Represents an Agent hired/attached to one Organization, including manager relationship and employment status.

### Role

Defines responsibilities, reporting relationship, authority policies, and prohibitions.

### Goal

Defines why work exists. Goals form a hierarchy.

### Task

A Work Contract containing objective, scope, dependencies, inputs, deliverables, acceptance criteria, owner/reviewer, constraints, and state.

### TaskRun

One concrete execution attempt of a Task.

### Lease

Temporary exclusive ownership of an active Task execution.

### Artifact

Logical durable work output.

### ArtifactVersion

Immutable version of an Artifact with provenance, checksum, storage URI, producer, and lineage.

### Decision

Authoritative organizational choice with scope, options, selected result, authority, rationale, status, and supersession history.

### Review

Structured evaluation of a Task/Artifact based on criteria and evidence.

### Permission

Capability grant/deny/condition for a Principal and Resource.

### ApprovalRequest

Durable request for an authorized human/agent/system principal to allow or reject a risk-gated action.

### Message

Non-authoritative communication: question, clarification, negotiation, notification, discussion.

### Event

Immutable record of a committed organizational fact.

### ContextManifest

Record of the authoritative inputs/capabilities/context sources compiled for one TaskRun.

## 5. Principals

Every command identifies one actor Principal:

- human
- agent membership
- system scheduler
- system runtime manager
- system review engine
- external agent
- service

No implicit internal superuser is assumed.

## 6. Command Envelope

Conceptual schema:

```json
{
  "command_id": "uuid",
  "type": "task.start",
  "organization_id": "uuid",
  "actor": {"type": "agent_membership", "id": "uuid"},
  "target": {"type": "task", "id": "uuid"},
  "expected_revision": 7,
  "idempotency_key": "opaque-key",
  "payload": {},
  "issued_at": "timestamp"
}
```

### Command processing order

1. schema validation
2. organization scope validation
3. idempotency lookup
4. aggregate load
5. revision check
6. policy authorization
7. domain invariant validation
8. transactional mutation
9. revision increment
10. organization event-sequence allocation
11. event insert
12. outbox insert
13. dedup result insert
14. commit

No model/tool/network side effects occur inside the DB transaction.

## 7. Event Envelope

```json
{
  "event_id": "uuid",
  "organization_id": "uuid",
  "organization_sequence": 912,
  "type": "task.started",
  "aggregate": {
    "type": "task",
    "id": "uuid",
    "revision": 8
  },
  "actor": {"type": "agent_membership", "id": "uuid"},
  "causation_id": "command-uuid",
  "correlation_id": "goal-or-workflow-uuid",
  "payload": {},
  "occurred_at": "timestamp"
}
```

Events are committed facts. Commands are intents and may be denied/failed.

## 8. Task state machine

```text
PROPOSED
   |
 validate
   v
 READY <----------------------------+
   |                                |
 acquire lease                      | lease expiry/rework
   v                                |
 LEASED                             |
   |                                |
 start                              |
   v                                |
 RUNNING -----> BLOCKED ------------+
   |
 submit work
   v
 REVIEW
  /   \
REWORK APPROVED
  |      |
 READY   v
      COMPLETED
```

Terminal outcomes additionally include FAILED, CANCELED, REJECTED where valid.

Ordinary workers cannot perform `RUNNING -> COMPLETED` directly.

## 9. Task readiness

A task becomes READY only when deterministic conditions are satisfied, including:

- organization active
- task accepted for execution
- all hard dependencies complete/waived
- required authoritative inputs available
- no blocking stale-input condition

Hard dependencies must form a DAG.

## 10. TaskRun and Lease

One Task may have multiple TaskRuns.

Only one active execution lease may own a Task under the v0.1 execution policy.

A run may become LOST when heartbeat/lease expires. The task can then be reconciled/rescheduled as a new attempt.

## 11. Artifact rules

1. Artifact logical identity is separate from ArtifactVersion.
2. Published ArtifactVersions are immutable.
3. New versions may supersede previous versions.
4. Consumers reference exact ArtifactVersion IDs.
5. Lineage/provenance is recorded.
6. Checksums are verified across trust/storage boundaries.
7. Supersession triggers stale-input/impact evaluation for consumers.

## 12. Decision rules

Conversation cannot directly change organizational truth.

Decision lifecycle:

```text
PROPOSED -> DISCUSSION -> APPROVAL_PENDING -> ACTIVE | REJECTED
ACTIVE -> SUPERSEDED
```

Approval requires authority according to Role + Policy.

## 13. Review rules

Work completion can require evidence such as:

- tests
- artifact existence
- schema validation
- security checks
- reviewer approval

Review may PASS, request REWORK, or FAIL according to policy.

## 14. Permission model

Authorization resolves:

```text
Principal
+ Role
+ Resource
+ Capability
+ Conditions
+ Organization policy
= ALLOW | DENY | REQUIRE_APPROVAL
```

Agents receive capabilities rather than direct unrestricted credentials whenever possible.

## 15. Messages

Messages support:

- question
- clarification
- notification
- discussion
- negotiation

Messages do not replace:

- Decision
- Artifact
- Task result
- Permission
- Approval

Important conversational outcomes must be committed through Commands into authoritative objects.

## 16. Context compilation

Canonical context order:

1. system/runtime safety rules
2. AOP operating contract
3. organization policy
4. identity
5. role/authority
6. mission/goal
7. Task Work Contract
8. active authoritative decisions
9. required artifacts/contracts
10. previous-attempt recovery information
11. derived memory
12. untrusted external evidence
13. allowed capabilities/tools
14. output/action schema

Mandatory authoritative fragments cannot be silently displaced by semantic ranking.

## 17. Context trust classes

- SYSTEM_POLICY
- AUTHORITATIVE
- TRUSTED_INTERNAL
- UNTRUSTED_EXTERNAL
- DERIVED_MEMORY

External data can inform reasoning but cannot redefine authority.

## 18. Memory model

### Tier 0 — Authoritative truth

Goals, tasks, decisions, artifacts, reviews, permissions, events. Stored outside the derived-memory layer.

### Tier 1 — Working memory

Run-local notes and intermediate state.

### Tier 2 — Episodic memory

Evidence-backed lessons from prior work.

### Tier 3 — Semantic knowledge memory

Searchable summaries/documents/domain knowledge.

Persistent memory must carry provenance and validation state. Agents cannot convert speculation into company truth by writing memory.

## 19. Runtime contract

Runtime adapter responsibilities:

```text
prepare
start
resume
cancel
inspect
collectUsage
collectTraceRefs
```

Runtime receives:

- TaskRun specification
- Context Manifest/rendered context
- workspace reference
- effective capabilities/tools
- execution limits
- tracing correlations

Runtime cannot directly mutate Kernel DB.

## 20. Workspace and sandbox

Workspace is durable task/run work state. Sandbox is disposable compute.

Coding runs use isolated Git worktrees/branches. Protected integration/merge remains a policy/review action.

Recovery recompiles current authoritative context and reuses durable workspace/checkpoint evidence rather than blindly replaying conversation.

## 21. Error model

Initial machine-readable error codes:

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
- CONTEXT_TOO_LARGE
- RATE_LIMITED
- INTERNAL_ERROR

Errors declare whether retry is appropriate.

## 22. Event catalog baseline

Key events include:

- organization.created/paused/resumed
- member.joined/suspended/left
- role.assigned/revoked
- goal.created/updated/completed
- task.created/ready/leased/started/blocked/submitted_for_review/rework_requested/completed/failed/canceled
- run.created/started/failed/lost/completed
- lease.acquired/heartbeat/expired/released
- artifact.created/version_published/approved/superseded
- decision.proposed/approved/rejected/superseded
- review.started/passed/rework_requested/failed
- permission.granted/revoked
- approval.required/approved/rejected

## 23. AOP v0.1 invariants

1. Agent cannot directly mutate authoritative state.
2. Authoritative mutations enter through Kernel Commands.
3. Accepted mutations emit Events atomically with state.
4. Messages are non-authoritative.
5. ArtifactVersions are immutable.
6. Task completion requires acceptance/review validation.
7. Only one active execution lease owns a task under v0.1 policy.
8. Authority is Role + Policy based.
9. Runtime loss does not destroy Organization state.
10. Context is compiled from authoritative state.
11. Every task traces to an organizational goal/objective.
12. Every action has an actor.
13. External effects require capabilities.
14. Changed authoritative inputs trigger impact evaluation.
15. An agent cannot grant itself authority.
16. Cross-organization references are denied in v0.1 unless explicitly supported by a future federation contract.
17. Idempotency prevents duplicate accepted side effects from command retries.
18. Revision checks prevent stale concurrent writes.

## 24. Versioning

External clients/adapters identify protocol version, initially:

```text
AOP-Version: 0.1
```

Stored events retain event-schema version metadata in implementation. Breaking semantic/state-machine changes require explicit migration/version handling.

## 25. PoC scope

AOP v0.1 will be proven through a five-role Software Company:

```text
Founder
  |
 CEO
  |
 CTO
 / | \
BE FE QA
```

The protocol is not considered validated until deterministic invariants, chaos recovery, verified product completion, and comparative benchmark experiments have been executed.

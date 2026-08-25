# T0020 — Scheduler / Readiness / Lease Coordination

Status: **COMPLETE**

Completed: 2026-08-25

Branch: `implementation/slice-1`

Primary evidence commit: `33d27019aaf3101f0dc8e2aa4ecd0328683ad6c0`

CI evidence: GitHub Actions CI #149 — workspace and PostgreSQL coordination jobs passed.

## Objective

Implement the first deterministic multi-worker coordination vertical slice without allowing the Scheduler, Runtime Manager, or workers to bypass the Organization Kernel.

The completed path is:

```text
PostgreSQL authoritative state
  -> deterministic candidate/readiness selection
  -> AOP Command Envelope
  -> Command Gateway
  -> scope + idempotency + policy
  -> domain invariants
  -> PostgreSQL transaction
  -> Task / TaskRun / Lease state
  -> ordered Events
  -> durable Outbox
```

Recovery follows the same authoritative write path:

```text
expired active Lease
  -> deterministic Lease Reaper
  -> lease.expire Command
  -> Command Gateway
  -> Lease expired + TaskRun lost + Task READY
  -> Events + Outbox
  -> Scheduler may create the next attempt
```

## Delivered protocol and command surface

### `task.claim`

Payload contains:

- `agentId`
- `runId`
- `leaseId`
- `attempt`
- `runtimeType`
- `workspaceId`
- `leaseSeconds`
- `heartbeatIntervalSeconds`

The command requires a Task target and `expectedRevision`.

### `lease.heartbeat`

Bounded Runtime Manager command that:

- requires a Lease target and `expectedRevision`
- only renews an active, non-expired lease
- extends expiry within v0 bounds
- records TaskRun heartbeat
- is policy-gated like every other authoritative command

### `lease.expire`

Bounded recovery command that:

- requires a Lease target and `expectedRevision`
- only expires an actually expired active lease
- marks the associated non-terminal TaskRun `lost`
- records `failure_reason = lease_expired`
- returns the Task from `leased`/`running` to `ready`
- clears `owner_agent_id` so failover may use another eligible agent

## Scheduler semantics

The deterministic Scheduler only selects candidates. It never mutates authoritative state directly.

Candidate eligibility requires:

- Organization active
- Goal active
- Task state `ready`
- all hard dependencies completed
- active organization membership
- active role assignment
- required capability match
- runtime adapter configured
- available v0 agent capacity
- optional existing Task owner compatible with selected agent

Ordering is deterministic by:

1. Task priority
2. Task creation time
3. Task ID
4. Agent ID

A selected candidate is converted to an idempotent `task.claim` command and sent through the Command Gateway.

## Claim transaction invariants

A successful claim atomically persists:

- Task `ready -> leased`
- Task owner
- new TaskRun / attempt
- new active Lease
- `task.leased` Event
- `task_run.created` Event
- `lease.acquired` Event
- corresponding Outbox rows
- command deduplication result

If any part fails, the transaction rolls back.

## Concurrency controls

### Task revision fencing

`task.claim` uses optimistic `expectedRevision` and locks the Task row.

### Idempotency serialization

Command deduplication uses a PostgreSQL advisory transaction lock scoped by Organization + idempotency key.

### Ordered Event allocation

Organization event sequence allocation uses an Organization-scoped advisory transaction lock.

### Task capacity

Existing schema guarantees one active Lease per Task and per Run.

Migration `0007_scheduler_capacity_v0.sql` additionally guarantees one active Lease per Agent for v0 scheduling capacity.

The handler checks capacity early for a useful protocol error; PostgreSQL remains the final concurrent safety barrier.

## Stable command identity

Scheduler claim identity is deterministic for:

```text
Organization + Task + Task revision + Agent + Attempt
```

The semantic command digest excludes delivery metadata such as `issuedAt`. A Scheduler process may therefore restart and retry the same semantic command without turning a valid idempotent replay into an idempotency conflict.

## Lease recovery design

### Heartbeat

`lease.heartbeat` updates both Lease and TaskRun revisions in one Command transaction.

A heartbeat is rejected when:

- Lease is not active
- Lease already expired
- expected revision is stale
- policy does not grant `lease.heartbeat`

### Reaper

`PostgresExpiredLeaseStore` scans only:

```sql
status = 'active' AND expires_at <= now
```

using the existing active-lease expiry index.

The Reaper itself is read-side detection only. It emits a deterministic `lease.expire` command with actor `system:runtime-manager`; it has no direct mutation path.

### Recovery transaction

A valid expiry atomically performs:

```text
Lease active  -> expired
TaskRun live  -> lost
Task leased/running -> ready
Task owner -> null
Events -> append
Outbox -> enqueue
Dedup -> accepted
```

The next Scheduler scan computes `MAX(attempt) + 1`, so recovered work becomes a new TaskRun instead of mutating the lost run.

## Worker process

`apps/worker` now runs three independent reconciliation loops under one shutdown signal:

1. durable Outbox delivery
2. deterministic Scheduler claim reconciliation
3. deterministic expired-Lease recovery

They coordinate only through PostgreSQL authoritative state and Command Gateway contracts. A process restart therefore does not destroy organization state.

## PostgreSQL evidence

CI #149 passed all coordination primitives, including the new recovery suite.

Verified scenarios include:

### Claim and replay

- first claim succeeds
- Task/Run/Lease/Event/Outbox persist atomically
- same idempotent command replays the original accepted result
- no duplicate TaskRun or Event is created

### Concurrent capacity race

Two READY Tasks concurrently try to claim the same v0 Agent:

- exactly one claim succeeds
- database active-agent-lease invariant prevents double allocation

### Hard dependency defense

A Task with an incomplete hard prerequisite:

- cannot be claimed
- remains READY
- does not get a TaskRun
- does not emit accepted mutation Events

### Candidate filtering

Scheduler candidate read-side verifies:

- deterministic ordering
- hard-blocked Tasks excluded
- Agent with consumed capacity excluded
- active role assignment required
- required capability match required

### Heartbeat revision fencing

A live Lease heartbeat:

- extends `expires_at`
- increments Lease revision
- records TaskRun heartbeat and revision

A stale expiry command carrying the pre-heartbeat revision is rejected with `revision_conflict` and cannot mark the live Run lost.

### End-to-end runtime-loss recovery

The recovery integration test proves:

```text
Task READY
 -> claim Agent A / attempt 1
 -> Lease expires
 -> Reaper discovers expiry
 -> lease.expire accepted
 -> Lease EXPIRED
 -> TaskRun 1 LOST
 -> Task READY, owner cleared
 -> Scheduler rescans
 -> Agent B selected
 -> attempt 2 claimed
```

After recovery/reclaim:

- attempt 1 remains immutable historical evidence as `lost`
- attempt 2 is a new TaskRun
- exactly one active Lease exists for the Task
- all accepted mutations have matching durable Events and Outbox records
- no manual database repair is used

## Compatibility hardening discovered during T0020

CI exposed node-postgres behavior that will be removed in pg@9: issuing concurrent `client.query()` calls with `Promise.all` on the same PoolClient.

The Query Store and authorization resolver were changed to sequential awaits when operating on one transaction client. This preserves transaction/snapshot consistency and removes the deprecated behavior.

Node-specific packages also explicitly opt into Node type definitions instead of adding Node globals to the shared protocol/domain TypeScript baseline.

## Invariants demonstrated

T0020 provides evidence for the following project invariants:

- agents/system workers do not directly mutate Kernel state
- accepted authoritative writes go through Command Gateway
- accepted mutations emit Events
- Task and TaskRun remain separate
- one active execution Lease per Task
- one active v0 Lease per Agent
- stale revisions cannot overwrite fresher execution ownership
- process/runtime loss does not destroy organization state
- lost work becomes retryable without rewriting history
- retries create a new attempt
- failover may select a different eligible Agent
- idempotent retries do not duplicate accepted state

## Result

T0020 is complete.

The deterministic Coordination Engine now has enough evidence to safely claim, fence, heartbeat, recover, and retry organizational work without requiring an LLM runtime or manual database repair.

# Slice 1 — Gate B Coordination / Recovery Checkpoint

Status: **PASS**

Date: 2026-08-25

Branch: `implementation/slice-1`

Primary evidence commit before documentation: `33d27019aaf3101f0dc8e2aa4ecd0328683ad6c0`

Primary CI evidence: GitHub Actions CI #149 — all workspace and PostgreSQL coordination checks passed.

## Gate definition

Gate B from the Master Implementation Plan requires:

> Task/run/lease/outbox recovery works without manual DB repair or duplicate accepted results.

Slice 1 additionally requires:

- authoritative organization query state
- Task DAG readiness behavior
- safe deterministic claiming of READY work
- exactly one active Lease per Task
- recoverable lost Runs after Lease expiration
- resumable observation / reconciliation

## Evidence map

### T0018 — Query Snapshot API

Status: COMPLETE.

Provides:

- PostgreSQL-authoritative Organization Snapshot
- `REPEATABLE READ` read consistency
- Task/Goal/Decision/Artifact/Approval query surfaces
- ordered Event history by `organization_sequence`
- resumable SSE using the same durable Event cursor
- reconnect independent of API process memory

The later T0020 hardening also removed concurrent `client.query()` calls on a single PoolClient so read snapshots remain compatible with the node-postgres pg@9 execution model.

### T0019 — Durable Outbox Worker

Status: COMPLETE.

Provides:

- Event + Outbox atomic commit boundary
- `FOR UPDATE SKIP LOCKED` worker claiming
- explicit processing ownership
- failed delivery retry with backoff
- stale worker reclamation
- at-least-once publication with `eventId` consumer idempotency contract
- PostgreSQL NOTIFY as acceleration only; durable polling/reconciliation remains correctness path

### T0020 — Scheduler / Readiness / Lease

Status: COMPLETE.

Provides:

- deterministic Scheduler candidate selection
- hard dependency readiness filtering
- capability / role / membership eligibility
- v0 Agent capacity fencing
- `task.claim` through Command Gateway
- atomic Task + TaskRun + Lease + Events + Outbox mutation
- deterministic command/idempotency identity
- Lease heartbeat with optimistic revision fencing
- deterministic expired-Lease Reaper
- atomic Lease expired + TaskRun lost + Task READY recovery
- owner release after runtime loss
- next-attempt scheduling and failover to another eligible Agent

## Gate B proof scenarios

### 1. Duplicate scheduling intent

The same semantic `task.claim` command may be retried after Scheduler/process restart.

Expected and verified:

- one accepted mutation
- same accepted result replayed
- no duplicate TaskRun
- no duplicate authoritative Events

### 2. Concurrent claim race

Two Tasks compete for one Agent with v0 capacity 1.

Expected and verified:

- only one active Lease may consume that Agent
- losing claim is rejected safely
- database constraint remains final concurrency barrier

### 3. Dependency race / stale readiness

Scheduler read-side may observe a candidate that changes before mutation.

Expected and verified through the Command boundary:

- Task row is revision-fenced
- hard dependencies are rechecked inside the claim transaction
- stale/invalid claim cannot create partial Run/Lease/Event state

### 4. Worker/process loss during Outbox delivery

Expected and verified:

- stale processing ownership can be reclaimed
- committed Event state remains durable
- publication may repeat but authoritative state is not duplicated

### 5. Runtime remains alive

Runtime Manager sends `lease.heartbeat` before expiry.

Expected and verified:

- Lease expiry is extended
- Lease revision increments
- TaskRun heartbeat is persisted
- a stale expiry carrying the old Lease revision cannot win

### 6. Runtime dies

No valid heartbeat arrives and Lease reaches `expires_at`.

Expected and verified:

```text
Lease ACTIVE
 -> Reaper observes expiration
 -> lease.expire Command
 -> Lease EXPIRED
 -> TaskRun LOST
 -> Task READY
 -> Task owner cleared
 -> Scheduler rescan
 -> new TaskRun / next attempt
```

No manual SQL repair occurs in the recovery path.

### 7. Failover

The full PostgreSQL integration scenario proves:

```text
Agent A / attempt 1
 -> runtime loss
 -> attempt 1 remains LOST history
 -> Task becomes READY
 -> Agent B is selected
 -> attempt 2 receives a new Lease
```

This demonstrates the frozen principle:

> Organization state outlives runtime processes.

## Observation / reconciliation proof

The Observer path does not rely on transient worker memory.

- Snapshot comes from authoritative PostgreSQL state.
- Events have monotonic Organization sequence numbers.
- SSE uses that sequence as event ID and reconnect cursor.
- A disconnected client can request Events after the last durable sequence.
- PostgreSQL NOTIFY is not required for correctness.
- Scheduler and Lease Reaper continuously reconcile PostgreSQL state rather than trusting transient notifications.

Therefore missed wake-ups, API reconnects, or worker restarts do not require a second source of truth.

## CI #149

The final implementation evidence run passed:

### Workspace

- install: PASS
- lint: PASS
- typecheck: PASS
- tests: PASS
- build: PASS

### PostgreSQL coordination

- migrations: PASS
- database constraints: PASS
- Query Store integration: PASS
- durable Outbox integration: PASS
- `task.claim` coordination integration: PASS
- Scheduler candidate integration: PASS
- Lease heartbeat/recovery integration: PASS

## Gate result

**Gate B = PASS.**

No LLM/runtime adapter is required to make this claim. Gate B verifies the deterministic coordination and recovery substrate only.

The project may now leave Slice 1 and begin **Slice 2 — Organizational Truth (E07–E08)** while preserving all Gate A/B invariants as regression tests.

## Next engineering focus

Slice 2 should now implement the production command/persistence vertical slices for:

1. Artifact publish/version semantics
2. Artifact lineage + consumers
3. breaking-version impact analysis / stale work detection
4. Decision authority / activation / supersession
5. Review + rejection/rework control of completion
6. verified Reporting Engine

Marketplace and real LLM runtime work remain locked until their later planned slices/gates.

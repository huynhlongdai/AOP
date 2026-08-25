# T0009 — Migration 0002 Task Engine

Date: 2026-08-25
Status: IMPLEMENTED — PostgreSQL execution gate pending Docker/CI environment

## Migration

`packages/database/migrations/0002_task_engine.sql`

Creates:

- `tasks`
- `task_dependencies`
- `task_runs`
- `leases`
- readiness/runtime-oriented indexes

## Database-enforced invariants

### Task

- Goal must belong to the same organization.
- Owner/reviewer Agent must be a member of the same organization.
- Creator Principal type must match its ID shape.
- `blocked` state requires structured reason/detail/timestamp.
- non-blocked state cannot retain stale blocker fields.
- `completed` state requires `completed_at`.

### Dependency

- both tasks belong to the same organization.
- a task cannot directly depend on itself.
- duplicate dependency edges are impossible.

Full DAG-cycle prevention remains a domain-service responsibility (T0013).

### TaskRun

- run belongs to the same organization/task.
- executing Agent is an organization member.
- `(organization, task, attempt)` is unique.
- attempt is positive.

### Lease

- lease references same-org Task and TaskRun.
- Agent is a same-org member.
- expiry is later than acquisition.
- partial unique indexes allow only one ACTIVE lease per Task and one ACTIVE lease per Run.

## Important separation

```text
Task = durable Work Contract
TaskRun = one execution attempt
Lease = temporary right to execute that Task through that Run
```

A lost/failed Run does not erase the Task.

## Not yet represented

- normalized Task artifact inputs/outputs (T0010)
- readiness calculation / DAG cycle detection (T0013)
- Task transition legality (T0012)
- lease acquisition/heartbeat/expiration service (T0020)

## Next ticket

T0010 — Migration 0003 Organizational Truth.

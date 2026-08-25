# T0013 — Task DAG Service

Date: 2026-08-25
Status: IMPLEMENTED — CI execution pending

## Added

- `TaskDependency` protocol schema
- hard / soft / informational dependency types
- duplicate-edge rejection
- graph cycle detection
- dependency removal validation
- deterministic hard-blocker calculation
- unit tests for multi-hop cycles and readiness blockers

## Edge direction

```text
Task A -> Task B
```

means **A depends on B**.

When adding `A -> B`, the service checks whether B already has a path back to A. If yes, the edge is rejected because it closes a cycle.

## Readiness semantics

Only `hard` dependencies block execution readiness.

```text
hard           -> blocks until dependency = completed
soft           -> tracked, does not block
informational  -> tracked, does not block
```

Scheduler can therefore calculate blockers from authoritative state without LLM judgment.

## Database + domain defense

Migration 0002 rejects self-dependencies and duplicate rows. T0013 additionally rejects multi-hop cycles that relational CHECK constraints cannot represent cleanly.

## Next ticket

T0014 — Artifact / Decision / Review lifecycle state machines.

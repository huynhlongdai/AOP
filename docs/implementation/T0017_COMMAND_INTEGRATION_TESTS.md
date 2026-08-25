# T0017 — Command Integration & Concurrency Tests

Date: 2026-08-25
Status: Complete
Slice: 0 — Deterministic Kernel

## Objective

Prove the Command Gateway invariants before connecting a real model/runtime.

## Test harness

A serialized transactional in-memory store models:

- transaction snapshots
- commit on success
- rollback on thrown error
- command deduplication
- organization event sequence
- Event append
- Outbox enqueue
- ApprovalRequest creation
- a representative aggregate revision

The harness intentionally tests semantics independently from a PostgreSQL adapter.

## Scenarios

1. Accepted bounded mutation records state + Event + Outbox + dedup result atomically.
2. Identical idempotent retry returns the same result and executes the handler once.
3. Reusing an idempotency key with different request content returns `idempotency_conflict`.
4. Two concurrent commands using the same aggregate revision produce exactly one winner and one `revision_conflict`.
5. Cross-organization/resource scope mismatch is rejected before mutation.
6. Policy `DENY` prevents the handler from executing.
7. `REQUIRE_APPROVAL` creates durable approval state + Event + Outbox without executing the handler.
8. Domain failure after a partial in-transaction mutation rolls back the mutation before recording the rejection.
9. Unexpected failure rolls back partial state and returns a retryable internal error without leaving misleading dedup state.

## CI evidence

GitHub Actions run #44 completed successfully at commit:

`26a5e19f70abb4af07d27b0dd264648a0c16e8c8`

The workspace validation path passed install, lint, TypeScript typecheck, Vitest tests and build.

## Database-level complement

T0017 does not claim the in-memory harness proves PostgreSQL constraints. A separate CI database job was added afterward to apply migrations on PostgreSQL 18 and run `packages/database/tests/slice0_constraints.sql`.

This separation is intentional:

```text
Domain/Command tests -> behavioral semantics
PostgreSQL constraint suite -> storage invariants
```

Both are required for Slice 0 Gate A.

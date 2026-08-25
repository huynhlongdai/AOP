# Slice 0 — Gate A Kernel Correctness Checkpoint

Date: 2026-08-25
Status: PASS pending external code review

## Gate definition

Gate A from the Master Implementation Plan requires deterministic Kernel correctness before any real agent/model is connected.

Required properties include:

- protocol/runtime validation
- authoritative PostgreSQL constraints
- deterministic domain lifecycle rules
- task DAG correctness
- bounded authority
- optimistic concurrency
- idempotency
- transaction/event/outbox atomicity

## Implemented tickets

Slice 0 engineering tickets completed:

- T0001 — Repository foundation
- T0002 — Local dependencies
- T0003 — Protocol IDs / Principal / ResourceRef
- T0004 — Organization / Agent / Membership / Role
- T0005 — Goal / Task / TaskRun / Lease
- T0006 — Truth / Governance schemas
- T0007 — Command / Event / ContextManifest envelopes
- T0008 — PostgreSQL foundation migration
- T0009 — Task Engine migration
- T0010 — Organizational Truth migration
- T0011 — Organization / Goal domain lifecycle
- T0012 — Task state machine
- T0013 — Task DAG service
- T0014 — Artifact / Decision / Review lifecycles
- T0015 — Deterministic Policy Engine
- T0016 — Command Gateway
- T0017 — Integration / concurrency tests

## Evidence 1 — Workspace CI

GitHub Actions run #44 passed:

- dependency install
- Biome lint
- TypeScript typecheck
- Vitest
- TypeScript build

Commit validated:

`26a5e19f70abb4af07d27b0dd264648a0c16e8c8`

## Evidence 2 — PostgreSQL runtime validation

GitHub Actions run #46 passed both jobs.

Workspace job:

- install PASS
- lint PASS
- typecheck PASS
- tests PASS
- build PASS

Database job using PostgreSQL 18.6:

- service startup PASS
- migrations `0001 -> 0002 -> 0003` PASS
- Slice 0 constraint suite PASS

Commit validated:

`c562a6ed8f2bce552d805a5fbfefa76d76ba3632`

Constraint suite verifies at minimum:

- cross-organization Goal/Task reference rejection
- only one active Lease per Task/Run
- ordered Event sequence uniqueness
- all migrations can execute on a clean database

## Evidence 3 — Command atomicity / concurrency

T0017 verifies:

- duplicate retry -> one mutation
- conflicting idempotency payload -> rejected
- concurrent stale revisions -> one winner / one conflict
- cross-scope target -> rejected
- policy deny -> no mutation
- approval-required -> durable approval, no protected mutation
- domain failure after partial mutation -> full rollback
- unexpected failure -> full rollback and retryable error

## Important implementation discovery

T0016 initially caught Domain errors within the mutation transaction. T0017 design exposed that this could permit partial state to commit.

The gateway was corrected so deterministic domain failures roll back the mutation transaction first, then persist the rejection in a separate transaction.

This is now part of the Kernel invariant set.

## Gate result

**Gate A technical evidence: PASS.**

The branch should now leave Draft status for external/code-review feedback. Review findings may still require fixes before merge, but no known deterministic Kernel blocker remains.

## Next phase after review/merge

Slice 1 begins with:

- T0018 — Query Snapshot API
- T0019 — Outbox worker
- T0020 — Scheduler / readiness / lease coordination

A real LLM/runtime remains prohibited until later Intelligence Boundary gates are reached.

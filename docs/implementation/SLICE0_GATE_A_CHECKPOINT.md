# Slice 0 — Gate A Kernel Correctness Checkpoint

Date: 2026-08-25
Status: **PASS — reviewed and CI validated**

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

A post-implementation integrity migration was also added:

- `0004_integrity_hardening.sql`

## Evidence 1 — Workspace CI

GitHub Actions run #44 passed the initial Command Gateway test set:

- dependency install
- Biome lint
- TypeScript typecheck
- Vitest
- TypeScript build

Commit validated:

`26a5e19f70abb4af07d27b0dd264648a0c16e8c8`

## Evidence 2 — PostgreSQL runtime validation

GitHub Actions run #46 established the initial database runtime gate using PostgreSQL 18.6.

Later internal review hardened DB/protocol invariants and GitHub Actions run #57 passed both jobs again.

Run #57 validates:

### Workspace

- install PASS
- lint PASS
- typecheck PASS
- tests PASS
- build PASS

### PostgreSQL

- PostgreSQL 18.6 service PASS
- migrations `0001 -> 0002 -> 0003 -> 0004` PASS
- Slice 0 constraint suite PASS

Constraint suite verifies at minimum:

- cross-organization Goal/Task reference rejection
- only one active Lease per Task/Run
- Lease identity must match the exact TaskRun Task + Agent + attempt
- superseded Decision must preserve authoritative approval history
- passing Review requires evidence
- ordered Event sequence uniqueness
- all migrations execute on a clean database

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

## Important implementation discoveries

### Finding A — Domain failure atomicity

The first T0016 gateway version caught Domain errors within the mutation transaction. T0017 design exposed that this could permit partial state to commit.

Fix:

- deterministic domain failures escape and roll back the mutation transaction first
- rejection is persisted only afterward in a separate clean transaction

### Finding B — Lease / TaskRun identity hole

Internal review found that independent FKs from Lease to Task, Run and Agent did not prove the referenced Run belonged to the same Task + Agent + attempt.

Fix:

- TaskRun now exposes a composite lease identity key
- Lease uses a composite FK `(organization, run, task, agent, attempt)`
- a negative PostgreSQL test proves mismatch rejection

### Finding C — Truth protocol / DB semantic drift

Internal review found three schema drifts:

- superseded Decisions could lose approval history
- passing Reviews could parse without evidence
- expired/cancelled Approval objects could contain decision metadata in protocol while DB rejected it

Fix:

- Protocol schemas were tightened
- `0004_integrity_hardening.sql` aligns durable DB constraints
- protocol and PostgreSQL negative tests were added

## Review status

PR #2 was moved from Draft to Ready for Review.

Automated external review was attempted but unavailable for non-code reasons:

- Copilot PR reviewer reported quota exhaustion
- CodeRabbit skipped review because the PR contained 123 files, above its 100-file review limit

Because neither service produced code findings, an explicit internal invariant/security review was performed over the highest-risk surfaces: Command Gateway, Policy Engine, Task state machine, truth lifecycles, Task/Run/Lease constraints and Event/Outbox persistence model.

That internal review found the Lease identity and truth-schema issues above, both fixed and revalidated by CI.

## Gate result

**Gate A technical result: PASS.**

No known deterministic Kernel blocker remains for Slice 0.

This does **not** authorize connecting a real LLM/runtime yet. The master plan still requires later coordination, governance and Intelligence Boundary gates before model execution is trusted.

## Next phase

Slice 1 begins after merge with:

- T0018 — Query Snapshot API
- T0019 — Outbox worker
- T0020 — Scheduler / readiness / lease coordination

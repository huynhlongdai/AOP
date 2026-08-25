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

## CI evidence

### Run #44

Established the initial Command Gateway behavioral gate:

- dependency install PASS
- Biome lint PASS
- TypeScript typecheck PASS
- Vitest PASS
- TypeScript build PASS

Commit:

`26a5e19f70abb4af07d27b0dd264648a0c16e8c8`

### Run #46

Established the first PostgreSQL runtime gate using PostgreSQL 18.6:

- workspace validation PASS
- migrations `0001 -> 0002 -> 0003` PASS
- database constraint suite PASS

### Run #57

Revalidated workspace + PostgreSQL after Lease identity and truth-semantics hardening:

- workspace validation PASS
- migrations through `0004_integrity_hardening` PASS
- database negative constraints PASS

### Run #60 — final internal-review gate

Final Slice 0 head after Task DAG identity alignment:

- workspace install/lint/typecheck/test/build PASS
- PostgreSQL 18.6 migration/constraint job PASS

Commit:

`19f7106a5ee1852c746210afda56a2de2522fa5c`

## Database constraint evidence

The Slice 0 database suite verifies at minimum:

- cross-organization Goal/Task reference rejection
- only one active Lease per Task/Run
- Lease identity must match exact TaskRun Task + Agent + attempt
- superseded Decision preserves approval history
- passing Review requires evidence
- ordered Event sequence uniqueness
- all migrations execute on a clean PostgreSQL 18.6 database

## Command atomicity / concurrency evidence

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

Independent FKs from Lease to Task, Run and Agent did not prove that the referenced Run belonged to the same Task + Agent + attempt.

Fix:

- TaskRun exposes a composite lease identity key
- Lease uses composite FK `(organization, run, task, agent, attempt)`
- PostgreSQL negative test proves mismatch rejection

### Finding C — Truth protocol / DB semantic drift

Internal review found:

- superseded Decisions could lose approval history
- passing Reviews could parse without evidence
- expired/cancelled Approval objects could contain decision metadata in protocol while DB rejected it

Fix:

- Protocol schemas tightened
- `0004_integrity_hardening.sql` aligns durable DB constraints
- protocol and PostgreSQL negative tests added

### Finding D — Task DAG edge identity drift

The database identifies one dependency by `(organization, task, prerequisite)`, while the first domain implementation included dependency type in the edge identity. This could allow `A -> B hard` and `A -> B soft` in domain memory before PostgreSQL rejected the duplicate.

Fix:

- domain edge identity now matches database uniqueness
- one task pair has one dependency edge
- changing hard/soft/informational is an update, not a second parallel edge
- regression test added

## Review status

PR #2 was moved from Draft to Ready for Review.

Automated external review was attempted but unavailable for non-code reasons:

- Copilot PR reviewer reported quota exhaustion
- CodeRabbit skipped review because the PR contained 123 files, above its 100-file review limit

Because neither service produced code findings, an explicit internal invariant/security review was performed over the highest-risk surfaces: Command Gateway, Policy Engine, Task state machine, Task DAG, truth lifecycles, Task/Run/Lease constraints and Event/Outbox persistence model.

That review found Findings B–D above; all were fixed and revalidated by CI.

## Gate result

**Gate A technical result: PASS.**

No known deterministic Kernel blocker remains for Slice 0.

This does **not** authorize connecting a real LLM/runtime yet. The master plan still requires later coordination, governance and Intelligence Boundary gates before model execution is trusted.

## Next phase

Slice 1 begins after merge with:

- T0018 — Query Snapshot API
- T0019 — Outbox worker
- T0020 — Scheduler / readiness / lease coordination

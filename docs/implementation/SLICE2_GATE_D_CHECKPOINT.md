# Slice 2 — Gate D Organizational Truth Checkpoint

Date: 2026-08-25
Status: **PASS — implementation and PostgreSQL evidence complete**
Branch: `implementation/slice-2`
PR: #4 — Slice 2 — Organizational Truth

## Gate definition

Slice 2 / Gate D proves that agents can coordinate through durable organizational truth rather than self-reported chat state.

Master Plan exit conditions:

1. Artifact versions immutable
2. lineage and consumers tracked
3. new breaking/current Artifact truth marks affected work
4. Decisions have bounded authority and supersession
5. QA review/rework controls Task completion
6. reporting is computed from verified authoritative state

All six conditions now have machine-verifiable implementation evidence.

## Implemented tickets

- T0021 — Artifact Create/Revise Write Path
- T0022 — Artifact Review & Approval
- T0023 — Artifact Consumer Invalidation / Stale Input Protection
- T0024 — Task QA Review/Rework & Completion Protection
- T0025 — Decision Authority & Supersession
- T0026 — Verified Organizational Reporting

Post-implementation integrity hardening migrations introduced during Slice 2:

- `0008_artifact_task_fk_hardening.sql`
- `0009_artifact_lineage_delete_hardening.sql`
- `0010_task_artifact_input_invalidation.sql`
- `0011_task_review_completion_guard.sql`

## Gate evidence map

### 1. Immutable Artifact versions — PASS

Evidence:

- create and revise are separate Commands
- revision creates a new ArtifactVersion rather than mutating content
- versions are contiguous
- new versions supersede the latest version
- concurrent create/revise races are fenced
- lineage and Task output references are transactionally validated

Primary record:

`docs/implementation/T0021_ARTIFACT_WRITE_PATH.md`

Primary CI evidence: **#156**.

### 2. Artifact review/approval establishes authoritative current truth — PASS

Evidence:

- `draft -> in_review -> approved|rejected`
- only latest version can enter/resolve lifecycle
- approval records approver/time
- new approved version atomically becomes `currentApprovedVersionId`
- prior approved version becomes `superseded` while preserving approval history

Primary record:

`docs/implementation/T0022_ARTIFACT_REVIEW_APPROVAL.md`

Primary CI evidence: **#164**.

### 3. Artifact consumers and stale work are detected/prevented — PASS

Staleness is derived organizational truth:

```text
Task input pins ArtifactVersion V1
Artifact current approved version becomes V2
V1 status = superseded
=> required Task input is stale
```

Evidence:

- `task_artifact_input_status` projection identifies stale consumers
- Scheduler excludes Tasks with required stale inputs
- direct `task.claim` is also blocked by PostgreSQL defense-in-depth
- Query/read side exposes invalidating current version
- optional stale inputs do not incorrectly block scheduling

Primary record:

`docs/implementation/T0023_ARTIFACT_CONSUMER_INVALIDATION.md`

Primary CI evidence: **#179**.

### 4. QA review/rework controls completion — PASS

Evidence:

- Task owner submits work for review
- reviewer identity is part of authoritative Work Contract
- only assigned reviewer may resolve
- `pass` moves Task to COMPLETED
- `rework` moves Task back to READY for another attempt
- stale required inputs prevent review pass/completion
- PostgreSQL completion guard prevents direct SQL/buggy path from bypassing Review evidence

Primary record:

`docs/implementation/T0024_TASK_QA_REVIEW_REWORK.md`

Primary CI evidence: **#184**.

### 5. Decision authority and supersession — PASS

Evidence:

- generic command permission is not enough for Decision approval
- actor must satisfy Decision-specific `authorityCapability`
- activation is revision-fenced
- replacement and previous Decision preserve scope/authority boundary
- activation + supersession + impact + Event + Outbox occur atomically
- concurrent replacement race produces exactly one winner

Primary record:

`docs/implementation/T0025_DECISION_AUTHORITY_SUPERSESSION.md`

Primary CI evidence: **#192**.

### 6. Verified reporting from authoritative state — PASS

Evidence:

- Reporting Store is read-only
- one `REPEATABLE READ READ ONLY` transaction per report
- report uses Task/Run/Lease/Artifact/Decision/Review/Event authoritative state
- same snapshot provides `latestEventSequence`
- historical Task completion is separated from current verified completion
- completed Task loses verified-progress credit when a required input becomes stale later
- explicit `decision_impacts(..., 'blocks')` determines Decision blockers
- pending Decisions/rework Reviews are separated as attention items
- unknown Organization does not produce fabricated status

Primary record:

`docs/implementation/T0026_VERIFIED_REPORTING.md`

Primary CI evidence: **#206** (`32863128275`).

## Cross-cutting organizational truth invariants

Gate D now demonstrates:

- authoritative state changes still flow through Command -> Policy -> Domain -> Transaction -> Event/Outbox
- Artifact content history is immutable by version
- approvals preserve historical evidence
- Task completion requires review evidence
- changed authoritative inputs can invalidate current verification without rewriting history
- Decision authority is bounded independently of generic command capability
- organization reporting is computed, not narrated by an agent
- stale work cannot be silently scheduled, claimed or shipped as currently verified
- Events/Outbox continue to accompany authoritative mutations
- all Slice 0/1 coordination regression suites remain green

## Important Slice 2 findings fixed before Gate D

### Artifact producer FK delete semantics

Composite `ON DELETE SET NULL` attempted to null organization identity as well as producer Task.

Fixed by migration `0008` so only producer reference is cleared appropriately.

### Artifact lineage organization deletion semantics

Immediate restrictive lineage FK could make organization cascade order-dependent.

Fixed by migration `0009` using deferred integrity semantics while preserving direct parent protection.

### Completion protection

Application-level review checks alone were not enough defense-in-depth.

Migration `0011` adds validation-only PostgreSQL completion guards.

### Reporting snapshot consistency

Independent queries could create a report from mixed organization revisions.

Fixed with one repeatable-read read-only transaction.

### Historical completion vs current verification

A correctly completed Task may later depend on stale truth.

Reporting now preserves historical completion while revoking current verified-progress credit.

### Governance attention vs blocker

Pending approval does not automatically mean blocked work.

Only explicit Decision `blocks` impacts are reported as governance blockers.

## Final technical gate result

**Gate D: PASS.**

No known Slice 2 organizational-truth blocker remains.

This does **not** authorize a runtime to bypass the Kernel. Slice 3 is specifically responsible for proving the Intelligence Boundary before trusting a real agent/model.

## Next phase — Slice 3 Intelligence Boundary

Epics:

- E09 — Context Compiler
- E10 — Runtime Manager / first agent adapter

Required next proofs:

1. exact persisted Context Manifest per run
2. mandatory current Decisions/Artifacts cannot be silently dropped
3. untrusted context cannot redefine authority
4. first real CTO receives bounded Work Contract
5. CTO may emit only valid AOP Commands
6. invalid commands are denied safely
7. model/tool/run usage is traceable
8. runtime receives no direct PostgreSQL mutation capability

PR #4 may move from Draft to Ready only after the documentation head is revalidated by CI and PR state/head are rechecked.

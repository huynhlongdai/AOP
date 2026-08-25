# T0022 — Artifact Review and Approval

Date: 2026-08-25
Status: COMPLETE

## Goal

Create an explicit authority boundary between an ArtifactVersion merely existing and that version becoming authoritative organizational truth.

## Implemented

### Commands

- `artifact.submit_review`
- `artifact.approve`
- `artifact.reject`

All lifecycle commands:

- target an existing Artifact
- require `expectedRevision`
- target an explicit ArtifactVersion ID
- pass through Command Gateway / Policy / Domain / transaction / Event / Outbox

### Lifecycle invariants

For the v0 proof:

- only the latest ArtifactVersion can enter review or be approved/rejected
- stale lifecycle commands against older versions are rejected
- `draft -> in_review`
- `in_review -> approved | rejected`
- approval updates Artifact `currentApprovedVersionId`
- if another approved version already exists it becomes `superseded`
- superseded versions retain historical approver and approval timestamp
- ArtifactVersion URI/checksum/content metadata is never changed by lifecycle transitions
- Artifact revision is the concurrency boundary for lifecycle mutation

### Authority

Lifecycle capabilities are independent:

- `artifact.submit_review`
- `artifact.approve`
- `artifact.reject`

An agent allowed to create/revise/submit work is not implicitly allowed to approve its own output.

### Persistence

Artifact row locking serializes lifecycle commands. PostgreSQL persistence checks both:

- expected Artifact revision
- expected previous ArtifactVersion status

Approval updates the current approved pointer and target/prior version status in one transaction with Events, Outbox and command deduplication.

## Integrity discovery and hardening

Lifecycle cleanup exposed an order-sensitive lineage deletion defect: `artifact_lineage_parent_fk ON DELETE RESTRICT` could block Organization/Artifact deletion while sibling cascade actions were removing child lineage rows.

Migration `0009_artifact_lineage_delete_hardening.sql` changes the parent constraint to:

```sql
ON DELETE NO ACTION
DEFERRABLE INITIALLY DEFERRED
```

This retains the invariant that a parent ArtifactVersion cannot disappear while a surviving lineage child references it, while allowing deletion of an entire Artifact/Organization graph to become valid once the transaction reaches a consistent final state.

## Evidence

GitHub Actions CI #164:

- workspace lint/typecheck/tests/build: PASS
- migrations 0001–0009: PASS
- database constraint gate: PASS
- Query Store: PASS
- durable Outbox: PASS
- task.claim/Scheduler/lease recovery: PASS
- Artifact write path: PASS
- Artifact review lifecycle: PASS

Lifecycle integration verifies:

1. latest draft enters review and becomes approved authoritative truth
2. ordinary producing agent cannot approve without authority
3. authorized human approval succeeds
4. later approved version supersedes old approved version and preserves historical approval metadata
5. rejecting a later version does not replace previous approved truth
6. lifecycle action against stale non-latest version is rejected without mutation

## Next

T0023 — Artifact Consumer Invalidation.

When a new version becomes authoritative, tasks consuming the superseded approved version must become visibly stale and must not silently continue as if their input were current. T0023 adds authoritative stale-input metadata, Scheduler exclusion, Query visibility and impact evidence.

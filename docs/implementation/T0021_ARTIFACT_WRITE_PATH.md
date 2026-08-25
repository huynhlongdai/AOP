# T0021 — Artifact Write Path

Date: 2026-08-25
Status: COMPLETE

## Goal

Make agent outputs enter AOP Organizational Truth through the same authoritative mutation boundary as the rest of the Kernel, with immutable-by-version content, deterministic version sequencing, lineage, Task-output linkage, idempotency, concurrency safety, Events, and Outbox atomicity.

## Implemented

### Protocol

- `ArtifactCreatePayloadSchema`
- `ArtifactRevisePayloadSchema`
- validated content descriptor: URI, MIME type, SHA-256 checksum, size, optional schema
- optional production reference with paired `producedByTaskId` + `deliverableType`
- `derivedFromVersionIds` validation and duplicate prevention

### Domain

- `createArtifactWithInitialDraft`
  - Artifact starts at revision 0
  - first version is exactly version 1
  - first version is `draft`
  - first version cannot supersede another version
- `addArtifactDraftVersion`
  - requires optimistic Artifact revision
  - new version must be exactly previous version + 1
  - new version must supersede the latest version
  - Artifact revision increments while version content remains append-only

### Command layer

- `artifact.create`
- `artifact.revise`
- explicit `artifact.create` / `artifact.revise` policy capabilities
- create commands do not target a pre-existing resource
- revise commands target an existing Artifact and require `expectedRevision`
- all accepted mutations emit Artifact and ArtifactVersion Events

### PostgreSQL transaction layer

- Artifact create identity is serialized with a transaction-scoped advisory lock.
- Artifact revise uses row locking plus optimistic revision checks.
- ArtifactVersion rows are inserted, never content-updated by the write path.
- derived lineage is persisted in `artifact_lineage`.
- Task-produced versions are persisted in `task_artifact_outputs`.
- Task and derived-version references are validated inside the Organization boundary before persistence.
- Artifact state, version, lineage/output links, Events, Outbox and command deduplication share the Command Gateway transaction.

## Integrity discovery and hardening

T0021 exposed a pre-existing schema defect in migration 0003:

```sql
FOREIGN KEY (organization_id, produced_by_task_id)
  REFERENCES aop.tasks(organization_id, id)
  ON DELETE SET NULL
```

For a composite foreign key PostgreSQL attempted to null both columns, including NOT NULL `organization_id`, when the producing Task/Organization was deleted.

Migration `0008_artifact_task_fk_hardening.sql` replaces this with:

```sql
ON DELETE SET NULL (produced_by_task_id)
```

so Artifact provenance can lose the deleted Task reference without corrupting Organization identity.

## PostgreSQL evidence

GitHub Actions CI #156:

- workspace lint: PASS
- workspace typecheck: PASS
- workspace tests: PASS
- workspace build: PASS
- migrations 0001–0008: PASS
- database constraint gate: PASS
- Query Store integration: PASS
- durable Outbox integration: PASS
- task.claim integration: PASS
- Scheduler candidate integration: PASS
- lease heartbeat/recovery integration: PASS
- Artifact write-path integration: PASS

Artifact integration verifies:

1. create version 1 + Task output + Events + Outbox atomically
2. exact idempotent replay creates no duplicate version or Event
3. revision creates contiguous version history with explicit supersession and lineage
4. original version checksum/content metadata remains unchanged
5. two concurrent revisions from one expected Artifact revision -> exactly one accepted
6. two concurrent creates of one Artifact identity -> exactly one accepted
7. missing lineage reference -> rejected with no partial Artifact/Event/Outbox state

## Invariants established

- Artifact content is immutable by version.
- Version history is contiguous for the current v0 write path.
- Revision ownership is protected by optimistic concurrency.
- Artifact identity creation is serialized.
- Cross-Organization/missing production references are rejected.
- Task output and lineage are authoritative graph edges, not chat metadata.
- Accepted Artifact mutations are auditable through ordered Events.
- No Artifact mutation bypasses Command Gateway / Policy / Domain / transaction semantics.

## Next

T0022 — Artifact Review and Approval.

A draft version is not authoritative merely because it exists. T0022 moves versions through review and approval, maintains `currentApprovedVersionId`, supersedes the prior approved version with preserved approval history, and creates the authority boundary required before stale/impact propagation can be implemented.

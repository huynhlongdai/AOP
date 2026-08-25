# T0010 — Migration 0003 Organizational Truth

Date: 2026-08-25
Status: IMPLEMENTED — PostgreSQL execution gate pending Docker/CI environment

## Migration

`packages/database/migrations/0003_organizational_truth.sql`

Creates the durable truth/governance/event backbone:

- command deduplication ledger
- artifacts
- artifact versions
- artifact lineage
- normalized task artifact inputs/outputs
- decisions
- decision impacts
- reviews
- permissions
- approval requests
- context manifests
- ordered organization events
- outbox events

## Key database invariants

### Idempotency

`(organization_id, idempotency_key)` is unique and records the request digest, command ID, lifecycle and result. `command_id` is unique inside an organization.

### Artifact history

- Artifact identity is separate from immutable versions.
- version number is unique per Artifact.
- `supersedes_version_id` must reference a version of the same Artifact.
- current approved version must belong to the same Artifact.
- approved **and superseded** versions retain historical approval metadata.
- lineage cannot self-reference.

### Task ↔ Artifact contracts

Inputs/outputs are normalized and constrained to the same organization as both Task and ArtifactVersion.

### Decision / Review / Permission / Approval

- Principal/reference shapes are DB-validated.
- active Decisions require selection, rationale and approval metadata.
- Reviews require completion timestamp once no longer pending.
- Permission effect is `allow | require_approval | deny`.
- Approval requests reference the original idempotent Command record.
- human-required approvals cannot be decided by an Agent principal.

### Context Manifest

Context Manifest must reference the exact `(organization, run, task, agent)` identity tuple, preventing a manifest from being attached to another run/worker accidentally.

### Event / Outbox

- organization sequence is unique and positive.
- aggregate references and actor identities are validated by type/prefix.
- command causation can point to the idempotency ledger.
- Outbox has one delivery record per Event and explicit retry/claim state.

## Helper functions

Migration adds:

- `aop.is_principal_ref(type, id)`
- `aop.is_resource_ref(type, id)`

These validate polymorphic references without giving polymorphic rows implicit authority.

## Implementation discovery

During T0010, protocol Artifact lifecycle was corrected: a version that transitions from `approved` to `superseded` must retain `approvedBy` and `approvedAt` for audit history. This was an implementation-driven refinement, not a change to the immutable-version principle.

## Slice 0 database backbone

After T0010 the planned authoritative tables for Slice 0 exist in migrations 0001–0003. Runtime execution still needs PostgreSQL validation.

## Next ticket

T0011 — Organization / Goal domain services.

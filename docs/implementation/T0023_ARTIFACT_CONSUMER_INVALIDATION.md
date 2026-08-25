# T0023 — Artifact Consumer Invalidation

Status: **COMPLETE**

Branch: `implementation/slice-2`

## Objective

Prevent agents from silently executing work against an Artifact version that is no longer authoritative after a newer version is approved.

## Design decision

Staleness is **derived organizational truth**, not duplicated mutable state.

The authoritative facts remain:

1. `task_artifact_inputs` pins the exact ArtifactVersion consumed by a Task.
2. `artifacts.current_approved_version_id` identifies the current authoritative version.
3. The consumed ArtifactVersion lifecycle records whether that version has been superseded.

`aop.task_artifact_input_status` derives:

- `invalidated_by_version_id`
- `invalidated_at`
- `stale`

This avoids a second mutable invalidation ledger and preserves the invariant that authoritative business mutations happen through Command/Policy/Domain transactions.

## Conservative v0 policy

When approved Artifact version B supersedes approved version A, every Task input pinned to A is considered stale. The Kernel does not ask an LLM whether the change is semantically breaking.

Required stale inputs block execution. Optional stale inputs remain visible but do not block scheduling.

## Implementation

### Database projection and invariant

Migration `0010_task_artifact_input_invalidation.sql` adds:

- `aop.task_artifact_input_status` derived view;
- `aop.prevent_stale_required_task_claim()`;
- `tasks_prevent_stale_required_input_claim` trigger.

The trigger is defense in depth: even a direct `task.claim` path cannot transition a Task to `leased` while a required input is stale.

### Scheduler

`PostgresSchedulerCandidateStore` excludes Tasks for which the derived input-status view contains a required stale input.

Optional stale inputs do not remove a Task from the candidate set.

### Query/Observer projection

`PostgresTaskArtifactInputStatusStore` exposes derived Task input status to read-side consumers, including the exact replacement ArtifactVersion and invalidation timestamp.

### Events

A superseding Artifact approval emits `artifact.consumers_invalidated` with:

- superseded version;
- replacement version;
- conservative-policy marker;
- `impactSource: derived_projection`.

The Event and its Outbox row are committed through the normal Command Gateway transaction.

## Evidence

### End-to-end PostgreSQL test

`packages/database/src/artifact-consumer-invalidation.integration.test.ts` proves:

1. approve v1;
2. pin a consumer Task to v1;
3. approve v2;
4. v1 becomes superseded;
5. read-side projection exposes v2 as `invalidatedByVersionId`;
6. `artifact.consumers_invalidated` Event exists;
7. matching Outbox record exists;
8. direct `task.claim` cannot create a TaskRun or Lease after the required input becomes stale.

### Scheduler PostgreSQL test

`packages/scheduler/src/postgres-candidate-store.integration.test.ts` proves:

- required stale input => Task excluded;
- optional stale input => Task remains schedulable.

### CI

GitHub Actions run **#179** passed both jobs:

- `Validate workspace` — success: lint, typecheck, tests, build;
- `Validate PostgreSQL coordination primitives` — success, including Artifact consumer invalidation and Scheduler stale-input policy.

CI run ID: `32854937852`.

## Invariants established

- No agent can safely begin new required-stale work through Scheduler.
- Bypassing Scheduler does not allow a stale Task to become leased.
- Staleness is reproducible from authoritative state instead of being a mutable cache.
- Optional and required inputs have different deterministic scheduling semantics.
- Superseding approval emits an auditable organizational event.

## Follow-up

T0024 will handle the harder case where a Task is already leased/running or reaches review while one of its required Artifact inputs becomes stale. That requires review/rework semantics and completion protection rather than only new-run prevention.

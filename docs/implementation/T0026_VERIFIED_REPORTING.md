# T0026 — Verified Organizational Reporting

Status: **COMPLETE**

Date: 2026-08-25
Branch: `implementation/slice-2`
PR: #4 — Slice 2 — Organizational Truth

## Objective

Compute organization progress, governance attention, blockers and runtime health directly from authoritative PostgreSQL state without allowing an agent or executive model to invent status.

Reporting is a deterministic read model. It does not mutate organization state and does not treat chat/messages or self-reported agent claims as progress.

## Implemented protocol

Added `OrganizationReportSchema` and supporting count/summary schemas for:

- Task states
- TaskRun states
- Lease states
- Decision states
- Review results
- Artifact truth
- verified progress
- blockers
- attention items
- organization Event sequence checkpoint

The report separates historical Task state from currently verified completion:

```text
historical completed Tasks
- completed Tasks with currently stale required inputs
= verified completed Tasks
```

This prevents an old completion from remaining “verified” after an authoritative Artifact it depended on is superseded.

## Implemented PostgreSQL Reporting Store

Added:

`packages/database/src/reporting-store.ts`

`PostgresReportingStore.getOrganizationReport()` derives the report only from authoritative tables/views:

- `organizations`
- `tasks`
- `task_runs`
- `leases`
- `decisions`
- `decision_impacts`
- `reviews`
- `artifacts`
- `task_artifact_input_status`
- `events`

Unknown Organizations return `undefined`; the Reporting Store never fabricates a report.

## Snapshot consistency

A report is built inside:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY
```

All report queries execute sequentially on the same PostgreSQL client and therefore observe one repeatable-read snapshot.

This prevents a report from combining Task counts from one organization revision with Decision/Artifact/Event data from another concurrent revision.

The final report includes `latestEventSequence` from the same snapshot.

## Verified progress semantics

The report exposes:

- `eligibleTasks`
- `verifiedCompletedTasks`
- `staleCompletedTasks`
- `ratio`

`eligibleTasks` excludes cancelled/rejected work.

A Task contributes to `verifiedCompletedTasks` only when:

1. its authoritative Task state is `completed`, and
2. it has no currently stale **required** Artifact input.

Task state history is preserved. If an Artifact is superseded after Task completion, `tasks.completed` remains historical truth while `verifiedCompletedTasks` decreases and `staleCompletedTasks` increases.

## Blocker vs attention semantics

The internal Slice 2 review found that a pending Decision is not automatically a blocker.

The final report distinguishes:

### Blockers

- Tasks explicitly in `blocked`
- Tasks with stale required Artifact inputs
- Decisions that have an authoritative `decision_impacts(..., impact_type = 'blocks')` relationship

### Attention

- proposed/discussion/approval-pending Decisions
- Reviews whose result is `rework`

A Decision can appear in both groups when it is pending and also explicitly blocks a resource.

## Machine-verifiable evidence

Added/extended:

`packages/database/src/reporting-store.integration.test.ts`

The PostgreSQL suite verifies:

1. exact deterministic report for a mixed organization state
2. Task/Run/Lease state counts
3. active/pending/superseded Decision counts
4. pending/pass/rework Review counts
5. Artifact current-version and stale-consumer counts
6. explicit Decision blocker relationships
7. pending Decision attention without implicit blocker inference
8. stale consumer removal immediately reconciles the report
9. a Task completed while inputs are current initially contributes verified progress
10. superseding that required input **after completion** revokes verified progress without rewriting Task completion history
11. unknown Organization returns `undefined`

CI runs this suite explicitly:

```text
Validate verified organizational reporting against PostgreSQL
```

## Important implementation discoveries

### Finding A — multi-query read consistency

The initial Reporting Store issued independent pool queries. That could combine values from different database snapshots.

Fix:

- one PostgreSQL client
- `REPEATABLE READ READ ONLY`
- one consistent organization snapshot

### Finding B — concurrent queries on one pg client

After introducing one transaction, the first implementation used `Promise.all()` on the same `pg` client. Current `pg` emitted a deprecation warning and `pg@9` will reject this pattern.

Fix:

- queries execute sequentially on the same transaction/client
- no concurrent `client.query()` calls

### Finding C — historical completion is not permanent verification

A Task can be correctly completed at time T1, then become invalid relative to current organization truth when a required Artifact is superseded at T2.

Fix:

- preserve historical Task completion
- compute `staleCompletedTasks`
- subtract stale completions from `verifiedCompletedTasks`

### Finding D — pending Decision is not automatically a blocker

A Decision requiring approval is an attention item, but it should not be reported as a blocker unless the organization explicitly records a `blocks` impact.

Fix:

- `blockingDecisionIds` comes only from `decision_impacts.impact_type = 'blocks'`
- pending Decision IDs move to the `attention` section

## CI evidence

### CI #202

Established the first complete Reporting Store PostgreSQL gate and snapshot-read implementation.

Result: **SUCCESS**.

### CI #204

Ran after semantic hardening for stale completions and blocker/attention separation.

Workspace: **SUCCESS**.

PostgreSQL regression suites before Reporting: **SUCCESS**.

Reporting test failed because its old expected object had not yet been updated to the new protocol semantics. This was an expected evidence mismatch, not a Kernel regression.

### CI #206 — final T0026 code gate

Run ID: `32863128275`

Result: **SUCCESS**.

Workspace:

- lint PASS
- typecheck PASS
- tests PASS
- build PASS

PostgreSQL:

- migrations PASS
- constraints PASS
- Query Store PASS
- Outbox PASS
- task.claim PASS
- Scheduler PASS
- lease heartbeat/recovery PASS
- Artifact write PASS
- Artifact review PASS
- Artifact invalidation PASS
- Task QA PASS
- Decision authority/supersession PASS
- verified organizational reporting PASS

## Invariants demonstrated

- Reporting cannot mutate authoritative state.
- Report calculations use authoritative PostgreSQL state only.
- One report is one repeatable-read snapshot.
- Event sequence checkpoint comes from the same snapshot.
- RUNNING work is not counted as completed progress.
- Historical completion can lose current verification when required truth changes.
- Optional/ordinary attention is not silently promoted into a blocker.
- Explicit Decision impact relationships determine governance blockers.
- Unknown organization state is not fabricated.

## T0026 verdict

**COMPLETE**.

This satisfies the final functional exit condition of Slice 2. The remaining action is to record the consolidated Slice 2 Gate D checkpoint, revalidate the documentation head, and transition PR #4 only if that checkpoint remains clean.

# T0025 — Decision Authority & Supersession

Status: **COMPLETE**

Date: 2026-08-25
Branch: `implementation/slice-2`
PR: #4 — Slice 2 — Organizational Truth

## Objective

Make organizational Decisions authoritative, permission-bounded, revision-safe, auditable, and safely supersedable without allowing generic command permission to bypass the Decision's own authority boundary.

## Implemented write path

Commands:

- `decision.create`
- `decision.request_approval`
- `decision.activate`
- `decision.reject`

Protocol payloads are runtime validated. Commands mutate state only through the Command Gateway and PostgreSQL transaction boundary.

## Authority model

Decision activation/rejection requires two independent checks:

1. the actor must be permitted to execute the command capability (`decision.activate` / `decision.reject`), and
2. the actor must independently satisfy the Decision's `authorityCapability`.

This prevents a broadly privileged worker from approving decisions outside its delegated authority domain.

Example:

```text
command capability: decision.activate
Decision authorityCapability: decision.architecture.approve
```

Possessing the first does not imply the second.

## Decision lifecycle

Implemented deterministic path:

```text
PROPOSED
   |
   +--> APPROVAL_PENDING
            |
            +--> ACTIVE
            |
            +--> REJECTED
```

Existing domain lifecycle rules remain authoritative. Activation requires:

- current status `approval_pending`
- expected revision match
- selected option exists
- non-empty rationale
- recorded approver
- recorded effective time

## Supersession

A replacement Decision may declare `supersedesDecisionId` only when the target Decision is active at proposal time.

Replacement and previous Decision must preserve the same:

- Decision scope
- authority capability

On successful replacement activation, one PostgreSQL transaction:

1. activates the replacement,
2. supersedes the previous active Decision,
3. preserves previous selected option/rationale/approval history,
4. records `decision_impacts(... impact_type = 'supersedes')`,
5. appends authoritative Events,
6. enqueues Outbox records.

A failed replacement activation rolls the whole transaction back.

## Persistence

Added:

- `PostgresDecisionCommandTransaction`
- `PostgresDecisionCommandStore`
- public export from `@aop/database`

The transaction extends the existing review-aware command transaction so one store remains compatible with prior Artifact, Task, Review, lease and command-gateway infrastructure.

Decision creation uses a transaction advisory lock for Decision identity creation. Decision activation locks the affected Decision rows with deterministic ID ordering before mutation.

## Machine-verifiable evidence

Added:

`packages/database/src/decision-governance.integration.test.ts`

Covered cases:

1. create -> request approval -> activate with recorded authority evidence
2. generic `decision.activate` permission without Decision authority -> deterministic `forbidden`
3. stale expected revision -> `revision_conflict`, no partial activation/event
4. replacement activation -> old Decision `superseded`, new Decision `active`, supersession impact recorded
5. two concurrent replacements for one active Decision -> exactly one activation winner
6. rejection requires the same dynamic authority boundary

CI now runs this suite explicitly:

```text
Validate Decision authority and supersession against PostgreSQL
```

## CI evidence

GitHub Actions CI run: **#192** (`32859394858`)

Result: **SUCCESS**

Workspace job:

- lint: pass
- typecheck: pass
- tests: pass
- build: pass

PostgreSQL job:

- migrations: pass
- database constraints: pass
- Query Store: pass
- durable Outbox: pass
- task.claim: pass
- Scheduler: pass
- lease heartbeat/recovery: pass
- Artifact write: pass
- Artifact review: pass
- Artifact consumer invalidation: pass
- Task QA review/rework: pass
- Decision authority/supersession: pass

## Invariants demonstrated

- Command permission does not imply Decision authority.
- No direct authority self-grant is introduced.
- Decision activation is optimistic-concurrency protected.
- Approval history survives supersession.
- Supersession is atomic with Events/Outbox.
- Competing replacement Decisions cannot both supersede the same active Decision.
- Failed governance commands do not partially mutate authoritative state.

## Slice 2 impact

This completes the Decision authority/supersession portion of the Slice 2 exit criteria.

Remaining Slice 2 work is primarily **verified reporting derived from authoritative state**, followed by a consolidated Gate D evidence review.

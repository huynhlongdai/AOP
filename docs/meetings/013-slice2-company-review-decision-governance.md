# Company Meeting #013 — Slice 2 Company Review & Decision Governance Gate

Date: 2026-08-25
Chair: CEO / Product & Engineering Director
Branch: `implementation/slice-2`
PR: #4 — `Slice 2 — Organizational Truth`

## 1. Meeting purpose

1. Statistically inventory the current AOP implementation state against `main`.
2. Verify the real GitHub branch, PR and CI state instead of relying on conversation memory.
3. Review Slice 2 risks with engineering, data, policy/security and QA/SRE roles.
4. Finish T0025 Decision Authority & Supersession with machine-verifiable PostgreSQL evidence.
5. Decide the next executable work required to finish Slice 2 / Gate D.

## 2. Participants / company roles

- Founder / Owner — product authority
- CEO — prioritization, go/no-go and execution sequencing
- CTO — Kernel architecture and deterministic boundaries
- Platform Architect — command/event transaction model
- Data Architect — PostgreSQL truth, locking and supersession integrity
- Policy / Security Engineer — bounded authority and permission review
- QA / SRE — concurrency, regression and CI evidence
- CPO / UX — observer requirements; intentionally not leading this Kernel stage

## 3. Verified repository inventory

Baseline:

- `main`: `5b01d7fe183c640da265a58f48dd8984156e8068` — Slice 1 / Gate B baseline

Meeting checkpoint after T0025 evidence documentation:

- branch head: `bdf3fb85f914322c8ce2408f2f320675cc3e065d`
- branch status versus baseline: **ahead 47 / behind 0**
- changed files: **31**
- source/documentation delta: **+4,982 / -6 lines**
- PR #4: **OPEN + DRAFT**

The Draft state remains intentional until Slice 2 Gate D evidence is complete.

## 4. Verified CI state before this meeting's implementation

At pre-meeting T0025 persistence head `ccae9b6e7f48b2c368b20fc50598f9ccfe6d390a`:

- CI run #189: **SUCCESS**
- workspace lint/typecheck/test/build: pass
- PostgreSQL migrations and all existing Slice 2 suites: pass

Finding: Decision governance code compiled and did not regress existing suites, but there was **no dedicated Decision governance PostgreSQL evidence step**. Therefore T0025 could not yet be declared complete.

## 5. Status review by workstream

### Slice 0 — Deterministic Kernel

Status: **COMPLETE / Gate A PASS**

Evidence already recorded in `SLICE0_GATE_A_CHECKPOINT.md`.

### Slice 1 — Coordination Engine

Status: **COMPLETE / Gate B PASS**

Implemented authoritative query/read model, durable Outbox, deterministic Scheduler, Task/Run/Lease coordination and lease recovery.

### Slice 2 — Organizational Truth

Completed before this meeting:

- T0021 — Artifact create/revise write path
- T0022 — Artifact review/approval
- T0023 — Artifact consumer invalidation / stale input protection
- T0024 — Task QA review/rework and completion guard

In progress at meeting start:

- T0025 — Decision authority & supersession

Remaining after T0025:

- T0026 — Verified Reporting derived only from authoritative state
- consolidated Slice 2 / Gate D checkpoint

## 6. Architecture review findings

### CTO finding — command permission is not Decision authority

A generic permission such as:

```text
decision.activate
```

must not authorize an actor to approve every Decision.

Each Decision carries its own:

```text
authorityCapability
```

Therefore activation/rejection requires both the command permission and the Decision-specific authority capability.

### Data Architect finding — supersession is a multi-aggregate atomic operation

Replacement activation must atomically:

- activate replacement Decision
- supersede previous Decision
- preserve previous approval history
- record supersession impact
- emit Events
- enqueue Outbox records

Partial supersession is invalid.

### Policy/Security finding — privileged non-authority actor must still be denied

A user/agent may possess generic `decision.activate` permission while lacking e.g. `decision.architecture.approve`.

The Kernel must deterministically reject this actor.

### QA/SRE finding — concurrency must be tested, not reasoned about only

Two replacement Decisions may both be proposed while the same previous Decision is active.

If both activation commands race, exactly one replacement may win. The second must fail and may not manufacture a second supersession fact.

### CPO finding — do not shift engineering to polished UI yet

Observer UI remains valuable, but current project value depends on authoritative organizational truth. UI work must not interrupt Gate D completion.

## 7. Decisions committed by the meeting

### D-MTG013-01 — T0025 evidence before moving forward

T0025 cannot be marked complete from compile/regression evidence alone. Dedicated PostgreSQL integration tests are mandatory.

### D-MTG013-02 — Two-layer Decision authority

Decision activation/rejection requires:

1. command capability authorization, and
2. Decision `authorityCapability` authorization.

### D-MTG013-03 — Supersession is atomic

Activation of a replacement Decision and supersession of the previous Decision belong to the same authoritative transaction.

### D-MTG013-04 — Race test is a release requirement

Concurrent replacements for one active Decision must prove exactly one winner.

### D-MTG013-05 — PR #4 remains Draft

Do not mark the PR ready merely because T0025 passes. Slice 2 requires verified reporting and consolidated Gate D evidence first.

### D-MTG013-06 — T0026 is next

Next executable ticket: **T0026 — Verified Organizational Reporting**.

Reporting must derive status from authoritative Task/Artifact/Decision/Review/Run/Lease/Event state and must never ask an agent/CEO model to invent progress.

## 8. Implementation performed during the meeting

### 8.1 Export Decision store

`PostgresDecisionCommandStore` is now exported from `@aop/database`.

Commit:

`6fbaa788984c9b2304fc61bd1b9eff7dd6412fb9`

### 8.2 Add Decision PostgreSQL evidence suite

Added:

`packages/database/src/decision-governance.integration.test.ts`

Six machine-verifiable cases:

1. create -> request approval -> activate
2. generic activator lacks Decision authority -> forbidden
3. stale revision -> revision conflict / no partial activation
4. replacement activation atomically supersedes previous Decision
5. concurrent replacements -> exactly one winner
6. Decision rejection also requires dynamic authority

Commit:

`205d8b989c800965dde86203505d697ebb773752`

### 8.3 Make Decision evidence a CI gate

Added CI step:

```text
Validate Decision authority and supersession against PostgreSQL
```

Commit:

`d0573e848f1ff336c42100598cc7812d3f145a9a`

### 8.4 CI result

CI run #192 (`32859394858`): **SUCCESS**

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

### 8.5 T0025 evidence document

Added:

`docs/implementation/T0025_DECISION_AUTHORITY_SUPERSESSION.md`

Commit:

`bdf3fb85f914322c8ce2408f2f320675cc3e065d`

## 9. T0025 verdict

**COMPLETE**

Verified properties:

- authority is bounded by Decision domain, not only command name
- revision conflicts block stale activation
- supersession preserves historical Decision evidence
- supersession + events + outbox are transactionally coupled
- concurrent replacement cannot produce two winners
- failed governance commands do not partially mutate organizational truth

## 10. Slice 2 status after meeting

Estimated engineering status by required exit capability:

| Capability | Status |
|---|---|
| Immutable Artifact versions | Complete |
| Artifact lineage | Complete |
| Artifact consumers | Complete |
| Breaking/current Artifact detection | Complete |
| Stale input protection | Complete |
| QA review/rework controls completion | Complete |
| Decision authority | Complete |
| Decision supersession | Complete |
| Verified reporting | **Not yet complete** |
| Consolidated Gate D evidence | **Not yet complete** |

Gate D status: **NOT YET PASS**.

Reason: organizational reporting still needs to be computed and verified from authoritative state before Slice 2 can be closed.

## 11. T0026 implementation contract

### Objective

Build a Reporting Engine/read model that explains company progress without agent-generated status fabrication.

### Minimum report

Organization report must compute:

- Task totals by state
- verified completed Tasks
- Tasks in Review / Rework / Blocked
- stale required-input Tasks
- active and expired leases
- running/lost/failed/succeeded TaskRuns
- active Decisions
- pending Decisions
- superseded Decisions
- pending Reviews
- failed/rework Reviews
- current approved Artifacts
- stale Artifact consumers
- critical blockers
- verified progress ratio

### Reporting rules

- PostgreSQL authoritative state only
- no model summaries in the truth calculation
- no raw message/chat count as progress
- COMPLETED Task counts only because completion is already review/stale guarded
- report carries source revision / event sequence checkpoint
- deterministic output for the same DB state
- query-only; Reporting Engine cannot mutate organizational state

### Required evidence

- PostgreSQL fixture produces exact expected report
- stale consumer changes report immediately
- rework changes verified progress downward/appropriately
- pending Decision appears as governance blocker where configured
- report does not count RUNNING as completed progress
- report survives lease expiry / lost run state

## 12. Next execution order

1. T0026 protocol/report schema
2. PostgreSQL Reporting Store
3. deterministic report calculator
4. PostgreSQL integration fixtures
5. CI reporting gate
6. `T0026_VERIFIED_REPORTING.md`
7. consolidated `SLICE2_GATE_D_CHECKPOINT.md`
8. internal invariant/security review
9. only then decide whether PR #4 becomes Ready for Review

## 13. Meeting close

Company decision: continue Kernel-first implementation. AOP will not connect a real model or expand Marketplace work until organizational truth can be queried, governed, reviewed and reported with deterministic evidence.

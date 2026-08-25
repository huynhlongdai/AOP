# T0024 — Task QA Review, Rework, and Completion Protection

Status: **COMPLETE**

Branch: `implementation/slice-2`

Primary evidence commit: `474c21a24778f95e9eeb9745da5584b3a371b69d`

CI evidence: GitHub Actions CI run **#184** (`32857488870`) — workspace and PostgreSQL coordination jobs both passed.

## Objective

Make Task completion an independently verified organizational fact rather than a worker assertion.

A worker may finish an execution and submit its Task for review, but it cannot directly declare the Task complete. Completion requires a Review resolved by the reviewer encoded in the Task Work Contract, with evidence, while all required Artifact inputs remain current.

## Commands

### `task.submit_review`

Required properties:

- target is a Task
- caller is the Task's current owner Agent
- Task is `running`
- Task has a distinct `reviewerAgentId`
- required Artifact inputs are not stale
- Task has an active Run and Lease owned by the caller
- optimistic Task revision matches

Atomic effects:

1. Task `running -> review`
2. active TaskRun -> `succeeded`
3. active Lease -> `released`
4. create a pending Review assigned to `reviewerAgentId`
5. emit Events and matching Outbox rows

Events:

- `task.review_submitted`
- `review.created`
- `task_run.succeeded`
- `lease.released`

### `review.resolve`

Required properties:

- target is a Review
- caller exactly matches the Review reviewer Principal
- Review is pending
- Review subject is a Task
- Review reviewer still matches the Task Work Contract
- evidence belongs to the same Organization
- optimistic Review and Task revisions match

Results:

- `pass`: Review -> pass; Task `review -> completed`
- `rework`: Review -> rework; Task `review -> ready`
- `fail`: Review -> fail; Task `review -> failed`

A `pass` additionally requires at least one evidence Resource and no stale required Artifact inputs.

## Independent reviewer invariant

Having the capability `review.resolve` does not make an actor the reviewer for every Review.

The Command Gateway first applies capability policy. The handler then verifies object-level authority: the command actor must exactly match `Review.reviewer` and the reviewer must still match `Task.reviewerAgentId`.

This prevents a privileged worker from approving another review merely because it holds the generic capability.

The Task owner is also forbidden from submitting to itself as reviewer.

## Rework semantics

No new Task `rework` state was introduced.

A QA result of `rework` returns the Task to `ready`. The completed execution remains historical evidence, its Lease remains released, and the Scheduler can create a new TaskRun attempt later.

This keeps the Task state machine small while preserving the review loop in immutable Review/Event/Run history.

## Completion protection

Migration `0011_task_review_completion_guard.sql` adds a validation-only PostgreSQL completion guard.

The trigger does **not** mutate authoritative state. It rejects a transition to `completed` unless:

- `completed_at` is present
- `reviewer_agent_id` is present
- no required Task Artifact input is stale
- a matching passing Review exists
- the passing Review reviewer is the Task reviewer
- Review and Task completion timestamps match

A partial unique index also enforces one pending Task Review at a time.

This gives two independent protection layers:

1. Command/domain validation
2. database invariant at the final Task completion write

## Stale input behavior

T0023's derived `aop.task_artifact_input_status` projection is reused rather than introducing a second stale ledger.

If an Artifact input becomes stale while a Task is already in review:

- `review.resolve` with `pass` is rejected
- Review remains pending
- Task remains in `review`
- direct SQL attempt to mark the Task completed is rejected by PostgreSQL

This closes the important race where work was valid when submitted but authoritative input changed before QA approval.

If an input is superseded **after** a valid completion transaction commits, the historical Review remains truthful for the state observed at completion. Post-completion impact/revalidation belongs to the subsequent Decision/Impact work rather than rewriting history.

## PostgreSQL transaction model

`PostgresReviewCommandTransaction` extends the existing PostgreSQL command transaction and adds:

- stale required input query
- active Task execution locking
- Task review submission persistence
- Review locking
- Review resolution persistence

`task.submit_review` updates Run, Lease, Task, Review, Events, Outbox, and command deduplication inside one transaction.

`review.resolve` updates Review, Task, Events, Outbox, and command deduplication inside one transaction.

No agent receives a direct database mutation path.

## Integration evidence

`packages/database/src/task-review.integration.test.ts` proves:

1. running execution is closed and Review is created before QA
2. passing QA with evidence completes the Task
3. Event sequence and Outbox rows are committed
4. rework returns Task to READY without manufacturing completion
5. no active Lease survives the rework boundary
6. a privileged non-reviewer cannot resolve the Review
7. stale required inputs block Review pass
8. stale required inputs block direct SQL completion

`packages/database/tests/slice0_constraints.sql` also proves direct Task completion without passing Review is rejected at the database layer.

## Gate contribution

T0024 materially advances **Gate D — Organizational coherence**:

> known-stale work does not silently ship as valid.

It also establishes the completion evidence boundary needed for verified organizational reporting.

## Remaining Slice 2 work

T0024 does not yet complete Slice 2. Remaining major truth/governance work includes:

- Decision write path with authority and supersession
- Decision/Artifact impact relationships
- verified reporting computed from Task/Review/Artifact/Decision state
- Gate D consolidation tests across breaking authoritative changes

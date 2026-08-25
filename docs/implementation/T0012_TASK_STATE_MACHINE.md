# T0012 — Task State Machine

Date: 2026-08-25
Status: IMPLEMENTED — CI execution pending

## Deterministic actions

- create proposed Task
- mark ready
- acquire logical leased state
- start
- return to ready after Run loss
- block with structured reason
- submit for review
- request rework
- complete from review
- fail execution/review
- cancel active work
- reject proposed work

## Verified-completion invariant

A Task cannot move directly from `running` to `completed`.

```text
leased -> running -> review -> completed
                         |
                         +-> ready (rework)
```

`completeTaskFromReview` rejects any Task not already in `review`.

This is separate from actor authorization: the Command/Policy layer will decide who may invoke the review-completion action, while the state machine ensures even an authorized caller cannot violate lifecycle order.

## Blocked state

Blocking is explicit state with:

- reason
- detail
- since timestamp

Resuming a blocked Task returns it to `ready`, where Scheduler/Lease logic decides the next execution attempt.

## Run recovery

`returnTaskToReadyAfterRunLoss` allows `leased|running -> ready` while the lost TaskRun remains historical evidence. Task identity is never replaced by retry.

## Revision

Every accepted action requires the expected current revision and increments revision exactly once.

## Next ticket

T0013 — Task DAG service.

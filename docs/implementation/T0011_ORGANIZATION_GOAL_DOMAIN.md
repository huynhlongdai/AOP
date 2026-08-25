# T0011 — Organization / Goal Domain Services

Date: 2026-08-25
Status: IMPLEMENTED — CI execution pending

## Added

- deterministic `DomainError`
- optimistic revision assertion
- invariant helper
- Organization creation/status transitions/profile update
- Goal creation/status transitions
- unit-test fixtures for stale revisions and terminal states

## Organization lifecycle

```text
active -> paused -> active
   |         |
   +-------> closed

closed = terminal / immutable
```

## Goal lifecycle

```text
planned -> active -> completed
   |         |
   |         +-> blocked -> active
   |         |      |
   +-------> cancelled <---+

completed / cancelled = terminal
```

## Revision rule

Every accepted mutation requires `expectedRevision === current.revision` and increments revision exactly once.

A stale caller receives `revision_conflict`; it does not silently overwrite newer state.

## Boundary

These are pure domain functions. Relational same-org checks remain protected by PostgreSQL; actor authority remains the Policy Engine responsibility.

## Next ticket

T0012 — Task state machine.

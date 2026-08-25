# T0005 — Goal / Task / TaskRun / Lease Schemas

Date: 2026-08-25
Status: IMPLEMENTED — package install/test gate pending registry access

## Added

- Goal lifecycle and success criteria
- Task Work Contract schema
- structured Task block reasons
- artifact input references
- deliverable and acceptance contracts
- capability requirements
- bounded task budgets
- TaskRun attempts separated from Task identity
- Lease ownership/lifetime schema

## Key invariants represented at schema level

- completed goals require `completedAt`
- blocked tasks require a structured block reason
- non-blocked tasks cannot carry a stale block reason
- completed tasks require `completedAt`
- run attempt numbers are positive
- lease expiry must be later than acquisition

## Important boundary

The schema does **not** decide whether a Task may transition between two states. Transition legality belongs to the deterministic Task state machine in T0012.

Likewise, the schema cannot guarantee a single active lease per Task; that requires database constraints/transactional coordination in T0009/T0020.

## Work Contract model

```text
Goal
  -> Task
      -> scope
      -> authoritative inputs
      -> deliverables
      -> acceptance criteria
      -> required capabilities
      -> constraints
      -> budget
          |
          -> TaskRun attempt
              -> Lease
```

## Next ticket

T0006 — Artifact / Decision / Review / Permission / Approval schemas.

# T0014 — Artifact / Decision / Review State Machines

Date: 2026-08-25
Status: IMPLEMENTED — CI execution pending

## Artifact aggregate

Artifact content versions remain immutable. Lifecycle metadata is coordinated through the parent Artifact revision.

Approval flow:

```text
draft -> in_review -> approved -> superseded
                   \-> rejected
```

Approving a replacement version atomically produces the intended domain result:

- parent Artifact revision increments
- new version becomes approved
- `currentApprovedVersionId` points to the new version
- previous current version becomes superseded
- previous approval metadata is preserved for audit

## Decision lifecycle

```text
proposed -> discussion -> approval_pending -> active -> superseded
    \-----------> approval_pending
    \-----------> rejected
```

Activation requires a real option, rationale, approver and effective time.

## Review lifecycle

New Reviews start `pending`.

- `pass` requires evidence
- `rework` requires findings
- `fail` requires findings
- resolution records completion time and increments revision

## Boundary

Policy Engine decides whether an actor has authority to invoke these transitions. These state machines decide whether the transition itself is structurally valid.

## Next ticket

T0015 — Policy Engine skeleton.

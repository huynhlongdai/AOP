# T0004 — Organization / Agent / Membership / Role Schemas

Date: 2026-08-25
Status: IMPLEMENTED — package install/test gate pending registry access

## Design boundary

Agent identity is deliberately separate from organizational membership and role assignment.

```text
Agent identity
    |
OrganizationMembership
    |
RoleAssignment
    |
Role authority template
```

This prevents an agent package from carrying self-declared organization authority and allows the same agent identity/runtime package to be assigned differently across organizations.

## Added

- Organization schema
- autonomy/status/type enums
- Agent identity/runtime/capability schema
- OrganizationMembership lifecycle schema
- Role schema with responsibility and authority categories
- RoleAssignment schema
- duplicate capability detection
- membership `leftAt` lifecycle validation
- strict unknown-field rejection

## Authority rule

Role authority expresses capability categories only:

- allowed
- approval required
- denied

Actual authorization remains a deterministic Policy Engine responsibility. An agent cannot grant authority by editing its own identity/profile payload.

## Deferred to domain layer

Schema validation cannot prove relational invariants such as:

- role belongs to the same organization
- manager belongs to the same organization
- reports-to graph is acyclic
- one active assignment policy

Those checks belong to database/domain services in Slice 0.

## Next ticket

T0005 — Goal / Task / TaskRun / Lease schemas.

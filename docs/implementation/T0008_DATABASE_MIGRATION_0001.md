# T0008 — Database Bootstrap and Migration 0001

Date: 2026-08-25
Status: IMPLEMENTED — database execution gate pending Docker/PostgreSQL environment

## Migration

`packages/database/migrations/0001_foundation.sql`

Creates:

- `aop` schema
- migration registry
- prefixed-ULID validation helper
- organizations
- agents
- organization memberships
- roles
- role assignments
- goals
- relational constraints and indexes

## Database-enforced invariants

- prefixed ID shape
- organization status/autonomy enums
- Principal ID/type alignment for organization/goal owners
- membership `leftAt` lifecycle
- one membership record per organization/agent pair
- role reporting cannot point to itself
- role parent relation stays inside the same organization
- role assignment requires membership in the same organization
- assigned role belongs to the same organization
- manager belongs to the same organization
- goal completion requires `completed_at`
- goal parent belongs to the same organization
- organization root goal belongs to the organization

## Why duplicate checks in protocol and DB?

Protocol validation gives callers fast structured errors. PostgreSQL constraints protect authoritative state even if an application bug reaches the persistence boundary.

## Not yet implemented

- migration runner
- transaction repository layer
- database integration tests
- Task tables (T0009)
- Artifact/Decision/Event tables (T0010)

## Validation note

The current execution environment has no Docker daemon and cannot run the PostgreSQL migration. T0008 is therefore committed but its runtime database gate remains open until executed against PostgreSQL 18.x.

## Next ticket

T0009 — Migration 0002 Task Engine.

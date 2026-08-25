# T0003 — Protocol IDs and Principal Schemas

Date: 2026-08-25
Status: IMPLEMENTED — package install/test gate pending registry access

## Added

- protocol version schema (`0.1.0`)
- resource ID schemas using readable prefixes + Crockford ULID payloads
- `Principal` discriminated union: `human | agent | system`
- bounded system-principal IDs
- type-safe `ResourceRef` discriminated union
- shared parse/safe-parse helpers
- protocol unit-test fixtures

## ID prefixes

```text
usr human user
org organization
agt agent
mem membership
rol role
gol goal
tsk task
run task run
lea lease
art artifact
arv artifact version
dec decision
rev review
per permission
apr approval request
evt event
cmd command
ctx context manifest
```

## Security/property note

A `ResourceRef` validates both the declared resource type and the ID prefix. This avoids accepting structurally valid but semantically mismatched references such as `{ type: "task", id: "agt_..." }`.

Unknown fields are rejected for Principal payloads so untrusted callers cannot smuggle authority-like metadata into identity references.

## Dependency

`@aop/protocol` targets Zod 4 only.

## Next ticket

T0004 — Organization / Agent / Membership / Role schemas.

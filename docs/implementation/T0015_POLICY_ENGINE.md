# T0015 — Deterministic Policy Engine

Date: 2026-08-25
Status: Complete
Slice: 0 — Deterministic Kernel

## Objective

Implement a model-free authorization layer that resolves bounded agent authority from authoritative organization roles and explicit permissions.

## Implemented

Package: `packages/policy-engine`

Core function:

```text
evaluatePolicy(input) -> ALLOW | REQUIRE_APPROVAL | DENY
```

Inputs are resolved authoritative data only:

- organization ID
- Principal
- capability
- optional resource scope
- active explicit Permissions
- authoritative resolved Roles
- current time
- deterministic condition context

## Precedence

The engine uses fail-safe precedence:

```text
DENY
  > REQUIRE_APPROVAL
    > ALLOW
      > default DENY
```

An agent cannot gain authority by claiming a role or describing itself as privileged. Roles and Permissions must already have been resolved by the Kernel boundary.

## Scope behavior

Explicit permissions may be:

- capability-wide
- resource-scoped
- condition-scoped
- time-limited

Expired permissions are ignored.

## Tests

Coverage includes:

- default deny
- deny winning over allow
- approval-required winning over allow
- resource scope mismatch
- expired permission rejection

## Invariants established

1. Autonomous reasoning does not imply autonomous authority.
2. Authority is structured state, not prompt text.
3. Explicit deny is never weakened by another matching allow.
4. Consequential actions may be permitted only through durable approval workflows.
5. No model call is part of authorization correctness.

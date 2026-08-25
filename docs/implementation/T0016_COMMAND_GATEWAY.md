# T0016 — Command Gateway Transaction Skeleton

Date: 2026-08-25
Status: Complete
Slice: 0 — Deterministic Kernel

## Objective

Create the single authoritative mutation boundary for organizational state.

The gateway implements the frozen write-path principle:

```text
Command
  -> protocol validation
  -> handler resolution
  -> expected-revision requirement
  -> idempotency
  -> organization/resource scope
  -> authorization resolution
  -> Policy Engine
  -> domain handler
  -> Event
  -> Outbox
  -> durable command result
```

## Package

`packages/command-bus`

Important files:

- `src/contracts.ts`
- `src/gateway.ts`

## Architecture

The first implementation uses dependency-injected contracts instead of coupling the gateway directly to PostgreSQL:

- `CommandStore`
- `CommandTransaction`
- `AuthorizationResolver`
- `CommandHandler`
- `GatewayIds`
- request digest function
- clock

This keeps transaction semantics independently testable and allows a PostgreSQL adapter to be added without changing command behavior.

## Idempotency

The tuple of organization + idempotency key identifies one logical request.

Behavior:

- same key + same request digest -> return previous result
- same key + different request digest -> `idempotency_conflict`
- a completed accepted/rejected/approval result is reusable for retries

## Policy behavior

`DENY`:

- handler is not called
- rejection is stored

`REQUIRE_APPROVAL`:

- handler is not called
- durable ApprovalRequest is created
- `approval.requested` Event is appended
- matching Outbox event is enqueued
- command record becomes `approval_pending`

`ALLOW`:

- handler may execute within the transaction
- accepted mutation must emit at least one Event

## Atomicity discovery

During T0017 design we found a serious bug in the first gateway version.

The original implementation caught a `DomainError` inside the same transaction after a handler may already have mutated state. Returning a rejected result from that transaction could therefore commit a partial mutation together with the rejection record.

That violates the AOP invariant:

> A failed authoritative mutation must not partially persist.

### Fix

Domain failures now escape the mutation transaction so the store rolls it back entirely.

Only after rollback succeeds does the gateway open a clean transaction to persist the deterministic rejected command result.

Unexpected errors also roll back all partial state and remain retryable without creating a misleading accepted/rejected authoritative record.

This behavior is covered by T0017 tests.

## Invariants established

1. Agents never mutate authoritative storage directly.
2. Policy executes before domain mutation.
3. Failed domain mutation is transactionally rolled back.
4. Event and Outbox creation are part of accepted command atomicity.
5. Approval-required commands cannot accidentally execute their protected mutation.
6. Retries are deterministic through idempotency records.

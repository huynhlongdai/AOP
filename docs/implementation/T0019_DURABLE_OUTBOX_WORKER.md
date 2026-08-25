# T0019 — Durable Outbox Worker

Date: 2026-08-25
Status: COMPLETE

## Goal

Deliver committed AOP Events without coupling domain transactions to an external broker and without pretending that external publication can be exactly-once.

## Delivery semantics

AOP Slice 1 uses **at-least-once publication**.

- Event + Outbox row are committed atomically by the Kernel transaction boundary.
- Workers claim Outbox rows using PostgreSQL `FOR UPDATE SKIP LOCKED`.
- Claiming increments `attempt_count` and records worker ownership.
- Only the owning worker may acknowledge publish/failure.
- Publisher failure moves the row to `failed` with deterministic exponential retry backoff.
- Worker/process loss leaves a `processing` row that another worker may reclaim after the stale-lock timeout.
- If external publish succeeds but database acknowledgement fails, the stale row may be published again. Consumers therefore must be idempotent by `eventId`.

## Implemented

- Migration `0006_outbox_delivery_hardening`.
- Delivery-state constraints for pending/failed/processing/published rows.
- Stale-processing index.
- `PostgresOutboxStore` claim, publish ACK and failure/retry operations.
- `OutboxWorker` batch delivery and retry behavior.
- `runOutboxLoop` with abortable idle polling.
- `EventPublisher` boundary.
- `PostgresNotifyPublisher` fast path sends only event identity/sequence metadata through `pg_notify`.
- Runnable `apps/worker` process with configurable batch/retry/stale/idle settings and graceful shutdown.

## PostgreSQL NOTIFY role

`NOTIFY` is only a wake-up hint, not authoritative event storage. Consumers fetch durable Event state from PostgreSQL using Event ID / organization sequence. A missed notification therefore does not destroy work; reconciliation/polling remains the correctness path.

## Tests

Unit coverage verifies:

- successful publish + ACK
- publisher failure -> failed/retry state
- exponential backoff cap

PostgreSQL integration verifies:

- concurrent workers do not claim the same event
- non-owner ACK is rejected
- stale processing rows are reclaimed after worker loss
- failed rows are not reclaimed before `retryAt`
- retries increment attempt count

## Evidence

GitHub Actions run #95:

- workspace install/lint/typecheck/tests/build: PASS
- migrations 0001–0006: PASS
- database constraints: PASS
- Query Store PostgreSQL integration: PASS
- durable Outbox PostgreSQL integration: PASS

## Invariants

- Outbox delivery is durable.
- Claim ownership is explicit.
- Crashed workers do not permanently strand Events.
- Duplicate external delivery is permitted and must be handled idempotently by consumers.
- No Kafka or external message broker is required for the PoC.

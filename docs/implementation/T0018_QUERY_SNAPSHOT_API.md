# T0018 — Query Snapshot API

Date: 2026-08-25
Status: COMPLETE

## Goal

Expose authoritative AOP organization state to Observer/UI consumers without creating a second source of truth or allowing the read API to bypass the Command Gateway for mutations.

## Implemented

- Typed protocol query contracts for Organization Snapshot, Task Detail, Artifact Versions and Event Page.
- `PostgresQueryStore` reconstructs protocol-valid objects from normalized PostgreSQL state.
- Organization Snapshot runs in a read-only `REPEATABLE READ` transaction.
- Task inputs, Decision impacts and Artifact lineage are reconstructed from relationship tables and validated through protocol Zod schemas.
- Event history persists `schema_version` and `protocol_version` via migration `0005_event_versioning`.
- Ordered event pagination uses `organization_sequence` as the durable cursor.
- Fastify read-only Observer API exposes snapshot, goals, tasks, task detail, artifacts, decisions, approvals and events.
- SSE stream resumes with `Last-Event-ID` / `after` using the same organization sequence cursor.
- Valid-but-missing organizations return 404 rather than empty lists or endless empty SSE heartbeats.
- Internal SSE exceptions are logged server-side; clients receive a generic stream error.
- Runnable API process uses `DATABASE_URL` and performs graceful shutdown.

## Important discoveries

1. `events` originally did not persist EventEnvelope schema/protocol versions. Migration 0005 corrected the historical audit boundary.
2. Vitest initially relied accidentally on prior TypeScript build output for workspace package resolution. Source aliases now make tests independent of execution order.
3. Fastify's transitive `thread-stream` typings were incompatible with `@types/node@26`; AOP CI/runtime is Node 24, so Node typings are pinned to the matching Node 24 line rather than disabling library checking.

## Evidence

GitHub Actions run #77:

- workspace install/lint/typecheck/tests/build: PASS
- migrations: PASS
- database constraints: PASS
- Query Store PostgreSQL integration: PASS

T0018 behavior is also revalidated by later Slice 1 runs, including #95.

## Invariants

- Read API is read-only.
- Snapshot data comes from authoritative PostgreSQL state.
- Snapshot components share one database snapshot.
- Event cursors are monotonic organization sequence numbers.
- Reconnect does not depend on API/runtime process memory.
- Protocol-invalid database projections fail validation rather than being silently normalized.

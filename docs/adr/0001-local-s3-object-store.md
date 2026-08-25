# ADR-0001 — Local S3-Compatible Object Store

Date: 2026-08-25
Status: Accepted

## Context

AOP requires object storage for immutable artifact payloads. Earlier planning used MinIO as the example local service, but the design intentionally depends on an S3-compatible abstraction rather than a MinIO-specific API.

By 2026, MinIO Community is distributed source-only and the historical prebuilt community binaries are no longer maintained. Keeping an old container only for familiarity would weaken the local security/reproducibility baseline.

## Decision

Use Versity Gateway as the default local S3-compatible service in `compose.yaml`.

Keep application code provider-neutral behind `packages/artifact-store`.

## Consequences

Positive:

- maintained prebuilt local container
- Apache-2.0 project
- standard S3 client compatibility
- no MinIO-specific domain semantics enter AOP

Tradeoffs:

- local developer behavior may not perfectly match AWS S3
- S3 compatibility must be tested at the adapter boundary
- production storage provider remains a deployment decision

## Compatibility

No AOP protocol or Organization Kernel invariant changes. Only the local development implementation changes.

# T0002 — Docker Local Dependencies

Date: 2026-08-25
Status: IMPLEMENTED — runtime health gate pending Docker-capable environment

## Services

### PostgreSQL

- image: `postgres:18.6-alpine`
- authoritative state database
- local port: `5432`
- persistent named volume
- `pg_isready` health check

### S3-compatible object store

- implementation: Versity Gateway
- image: `versity/versitygw:v1.6.0`
- S3 endpoint: `http://localhost:7070`
- optional Web UI: `http://localhost:8080`
- persistent named volume

## Why Versity for local development?

The architecture only requires an S3-compatible object-store boundary. MinIO Community moved to source-only distribution and its historical prebuilt binaries are no longer maintained. For a reproducible local container stack, AOP therefore uses a maintained S3-compatible implementation instead of pinning an obsolete MinIO binary.

This is not a protocol change: production artifact storage remains behind the `artifact-store` package and may target AWS S3, another S3-compatible service, or a future adapter.

## Start

```bash
cp .env.example .env
docker compose up -d
```

## Verify

```bash
docker compose ps
```

Expected:

- `postgres` is healthy
- `object-store` is healthy

## Stop

```bash
docker compose down
```

To intentionally delete local state:

```bash
docker compose down -v
```

## Validation note

The execution environment used to prepare T0002 does not expose a Docker daemon/CLI, so container startup/health checks cannot be truthfully marked as executed here. The compose configuration is committed and must be verified by CI or a Docker-capable developer machine before the T0002 gate is closed.

## Next ticket

T0003 — Protocol IDs and Principal schemas.

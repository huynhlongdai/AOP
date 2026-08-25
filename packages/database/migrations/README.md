# AOP Database Migrations

Migrations are ordered SQL files and are part of the authoritative-state contract.

## Rules

- committed migrations are immutable once released on `main`
- every migration runs in a transaction unless PostgreSQL requires otherwise
- every table is organization-scoped where applicable
- cross-organization relationships should be prevented by composite foreign keys when practical
- schema constraints duplicate critical protocol invariants intentionally
- application code must not bypass migrations with ad-hoc DDL

## Local application

After `docker compose up -d` and loading `.env`:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database/migrations/0001_foundation.sql
```

A migration runner will replace the manual command in a later database ticket.

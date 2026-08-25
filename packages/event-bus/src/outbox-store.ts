import type { Pool, PoolClient } from "pg";

import { EventEnvelopeSchema, type EventEnvelope, type EventId } from "@aop/protocol";

export interface OutboxDelivery {
  readonly event: EventEnvelope;
  readonly attemptCount: number;
}

export interface OutboxStore {
  claimBatch(workerId: string, limit?: number, staleAfterMs?: number): Promise<readonly OutboxDelivery[]>;
  markPublished(eventId: EventId, workerId: string, publishedAt: string): Promise<void>;
  markFailed(eventId: EventId, workerId: string, error: string, retryAt: string): Promise<void>;
}

export class OutboxOwnershipError extends Error {
  constructor(eventId: EventId, workerId: string) {
    super(`Outbox event ${eventId} is not owned by worker ${workerId}`);
    this.name = "OutboxOwnershipError";
  }
}

function timestamp(value: unknown, field: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  throw new TypeError(`Expected ${field} to be a timestamp`);
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function numeric(value: unknown, field: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) throw new TypeError(`Expected ${field} to be numeric`);
  return result;
}

function json(value: unknown): unknown {
  if (typeof value === "string") return JSON.parse(value) as unknown;
  return value;
}

function mapClaimRow(row: Readonly<Record<string, unknown>>): OutboxDelivery {
  const causationId = optionalString(row.causation_id);
  return {
    event: EventEnvelopeSchema.parse({
      schemaVersion: numeric(row.schema_version, "schema_version"),
      protocolVersion: String(row.protocol_version),
      eventId: String(row.event_id),
      type: String(row.event_type),
      organizationId: String(row.organization_id),
      organizationSequence: numeric(row.organization_sequence, "organization_sequence"),
      aggregate: { type: row.aggregate_type, id: row.aggregate_id },
      aggregateRevision: numeric(row.aggregate_revision, "aggregate_revision"),
      actor: { type: row.actor_type, id: row.actor_id },
      correlationId: String(row.correlation_id),
      payload: json(row.payload),
      occurredAt: timestamp(row.occurred_at, "occurred_at"),
      ...(causationId === undefined ? {} : { causationId }),
    }),
    attemptCount: numeric(row.attempt_count, "attempt_count"),
  };
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresOutboxStore implements OutboxStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async claimBatch(workerId: string, limit = 50, staleAfterMs = 30_000): Promise<readonly OutboxDelivery[]> {
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(workerId)) throw new TypeError("workerId is invalid");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError("limit must be between 1 and 500");
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1) throw new TypeError("staleAfterMs must be positive");

    return withTransaction(this.#pool, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `WITH candidates AS (
           SELECT o.event_id
             FROM aop.outbox_events o
            WHERE (
              o.status IN ('pending', 'failed') AND o.available_at <= transaction_timestamp()
            ) OR (
              o.status = 'processing' AND
              o.locked_at <= transaction_timestamp() - ($3::bigint * interval '1 millisecond')
            )
            ORDER BY COALESCE(o.locked_at, o.available_at), o.created_at, o.event_id
            FOR UPDATE SKIP LOCKED
            LIMIT $2
         ), claimed AS (
           UPDATE aop.outbox_events o
              SET status = 'processing',
                  attempt_count = o.attempt_count + 1,
                  locked_at = transaction_timestamp(),
                  locked_by = $1,
                  published_at = NULL,
                  last_error = NULL
             FROM candidates c
            WHERE o.event_id = c.event_id
          RETURNING o.event_id, o.organization_id, o.attempt_count
         )
         SELECT c.event_id, c.organization_id, c.attempt_count,
                e.schema_version, e.protocol_version,
                e.type AS event_type, e.organization_sequence,
                e.aggregate_type, e.aggregate_id, e.aggregate_revision,
                e.actor_type, e.actor_id, e.causation_id, e.correlation_id,
                e.payload, e.occurred_at
           FROM claimed c
           JOIN aop.events e
             ON e.organization_id = c.organization_id
            AND e.id = c.event_id
          ORDER BY e.organization_id, e.organization_sequence`,
        [workerId, limit, staleAfterMs],
      );
      return result.rows.map(mapClaimRow);
    });
  }

  async markPublished(eventId: EventId, workerId: string, publishedAt: string): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE aop.outbox_events
          SET status = 'published',
              locked_at = NULL,
              locked_by = NULL,
              published_at = $3,
              last_error = NULL
        WHERE event_id = $1
          AND status = 'processing'
          AND locked_by = $2`,
      [eventId, workerId, publishedAt],
    );
    if (result.rowCount !== 1) throw new OutboxOwnershipError(eventId, workerId);
  }

  async markFailed(eventId: EventId, workerId: string, error: string, retryAt: string): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE aop.outbox_events
          SET status = 'failed',
              available_at = $3,
              locked_at = NULL,
              locked_by = NULL,
              published_at = NULL,
              last_error = $4
        WHERE event_id = $1
          AND status = 'processing'
          AND locked_by = $2`,
      [eventId, workerId, retryAt, error.slice(0, 4_000)],
    );
    if (result.rowCount !== 1) throw new OutboxOwnershipError(eventId, workerId);
  }
}

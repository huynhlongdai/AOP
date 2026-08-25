import { hostname } from "node:os";
import { Pool } from "pg";

import {
  OutboxWorker,
  PostgresNotifyPublisher,
  PostgresOutboxStore,
  runOutboxLoop,
} from "@aop/event-bus";

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function defaultWorkerId(): string {
  const host = hostname().replace(/[^A-Za-z0-9_.:-]/g, "_");
  return `outbox-${host}-${process.pid}`.slice(0, 160);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: databaseUrl });
  const workerId = process.env.OUTBOX_WORKER_ID ?? defaultWorkerId();
  const worker = new OutboxWorker({
    store: new PostgresOutboxStore(pool),
    publisher: new PostgresNotifyPublisher(pool, process.env.OUTBOX_NOTIFY_CHANNEL ?? "aop_events"),
    workerId,
    batchSize: positiveInteger("OUTBOX_BATCH_SIZE", process.env.OUTBOX_BATCH_SIZE, 50),
    staleAfterMs: positiveInteger("OUTBOX_STALE_AFTER_MS", process.env.OUTBOX_STALE_AFTER_MS, 30_000),
    retryBaseMs: positiveInteger("OUTBOX_RETRY_BASE_MS", process.env.OUTBOX_RETRY_BASE_MS, 1_000),
    retryMaxMs: positiveInteger("OUTBOX_RETRY_MAX_MS", process.env.OUTBOX_RETRY_MAX_MS, 60_000),
  });

  const controller = new AbortController();
  let stopping = false;
  const requestStop = () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
  };
  process.once("SIGTERM", requestStop);
  process.once("SIGINT", requestStop);

  try {
    await runOutboxLoop({
      worker,
      signal: controller.signal,
      idleDelayMs: positiveInteger("OUTBOX_IDLE_DELAY_MS", process.env.OUTBOX_IDLE_DELAY_MS, 500),
      onRunError: (error) => console.error("Outbox delivery cycle failed", error),
    });
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

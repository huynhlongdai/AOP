import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Pool } from "pg";

import {
  CommandGateway,
  LeaseExpireHandler,
  LeaseHeartbeatHandler,
  TaskClaimHandler,
  TaskRunFinishHandler,
  TaskRunPrepareHandler,
  TaskRunStartHandler,
  semanticCommandDigest,
  type GatewayIds,
} from "@aop/command-bus";
import { PostgresAuthorizationResolver, PostgresRuntimeCommandStore } from "@aop/database";
import {
  OutboxWorker,
  PostgresNotifyPublisher,
  PostgresOutboxStore,
  runOutboxLoop,
} from "@aop/event-bus";
import {
  DeterministicLeaseReaper,
  DeterministicScheduler,
  PostgresExpiredLeaseStore,
  PostgresSchedulerCandidateStore,
  deterministicPrefixedUlid,
  runLeaseReaperLoop,
  runSchedulerLoop,
} from "@aop/scheduler";

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function defaultWorkerId(): string {
  const host = hostname().replace(/[^A-Za-z0-9_.:-]/g, "_");
  return `worker-${host}-${process.pid}`.slice(0, 160);
}

function gatewayIds(now: () => string): GatewayIds {
  return {
    nextEventId: () =>
      deterministicPrefixedUlid("evt", now(), randomUUID()) as ReturnType<GatewayIds["nextEventId"]>,
    nextApprovalRequestId: () =>
      deterministicPrefixedUlid("apr", now(), randomUUID()) as ReturnType<GatewayIds["nextApprovalRequestId"]>,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: databaseUrl });
  const clock = () => new Date().toISOString();
  const workerId = process.env.OUTBOX_WORKER_ID ?? defaultWorkerId();
  const outboxWorker = new OutboxWorker({
    store: new PostgresOutboxStore(pool),
    publisher: new PostgresNotifyPublisher(pool, process.env.OUTBOX_NOTIFY_CHANNEL ?? "aop_events"),
    workerId,
    batchSize: positiveInteger("OUTBOX_BATCH_SIZE", process.env.OUTBOX_BATCH_SIZE, 50),
    staleAfterMs: positiveInteger("OUTBOX_STALE_AFTER_MS", process.env.OUTBOX_STALE_AFTER_MS, 30_000),
    retryBaseMs: positiveInteger("OUTBOX_RETRY_BASE_MS", process.env.OUTBOX_RETRY_BASE_MS, 1_000),
    retryMaxMs: positiveInteger("OUTBOX_RETRY_MAX_MS", process.env.OUTBOX_RETRY_MAX_MS, 60_000),
  });

  const commandGateway = new CommandGateway({
    store: new PostgresRuntimeCommandStore(pool),
    authorization: new PostgresAuthorizationResolver(clock),
    handlers: [
      new TaskClaimHandler(clock),
      new LeaseHeartbeatHandler(clock),
      new LeaseExpireHandler(clock),
      new TaskRunPrepareHandler(),
      new TaskRunStartHandler(clock),
      new TaskRunFinishHandler(clock),
    ],
    ids: gatewayIds(clock),
    digest: semanticCommandDigest,
    now: clock,
  });
  const scheduler = new DeterministicScheduler({
    store: new PostgresSchedulerCandidateStore(pool),
    executor: commandGateway,
    now: clock,
    candidateLimit: positiveInteger("SCHEDULER_CANDIDATE_LIMIT", process.env.SCHEDULER_CANDIDATE_LIMIT, 32),
    leaseSeconds: positiveInteger("SCHEDULER_LEASE_SECONDS", process.env.SCHEDULER_LEASE_SECONDS, 300),
    heartbeatIntervalSeconds: positiveInteger(
      "SCHEDULER_HEARTBEAT_INTERVAL_SECONDS",
      process.env.SCHEDULER_HEARTBEAT_INTERVAL_SECONDS,
      60,
    ),
  });
  const leaseReaper = new DeterministicLeaseReaper({
    store: new PostgresExpiredLeaseStore(pool),
    executor: commandGateway,
    now: clock,
    candidateLimit: positiveInteger("LEASE_REAPER_CANDIDATE_LIMIT", process.env.LEASE_REAPER_CANDIDATE_LIMIT, 64),
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
    await Promise.all([
      runOutboxLoop({
        worker: outboxWorker,
        signal: controller.signal,
        idleDelayMs: positiveInteger("OUTBOX_IDLE_DELAY_MS", process.env.OUTBOX_IDLE_DELAY_MS, 500),
        onRunError: (error) => console.error("Outbox delivery cycle failed", error),
      }),
      runSchedulerLoop({
        scheduler,
        signal: controller.signal,
        idleIntervalMs: positiveInteger("SCHEDULER_IDLE_INTERVAL_MS", process.env.SCHEDULER_IDLE_INTERVAL_MS, 1_000),
        onResult: (result) => {
          if (result.claimed !== undefined) {
            console.info("Scheduler claimed task", {
              organizationId: result.claimed.organizationId,
              taskId: result.claimed.taskId,
              agentId: result.claimed.agentId,
              attempt: result.claimed.attempt,
            });
          }
        },
        onError: (error) => console.error("Scheduler reconciliation cycle failed", error),
      }),
      runLeaseReaperLoop({
        reaper: leaseReaper,
        signal: controller.signal,
        idleIntervalMs: positiveInteger("LEASE_REAPER_INTERVAL_MS", process.env.LEASE_REAPER_INTERVAL_MS, 1_000),
        onResult: (result) => {
          if (result.recovered !== undefined) {
            console.warn("Recovered expired lease", {
              organizationId: result.recovered.organizationId,
              leaseId: result.recovered.leaseId,
              leaseRevision: result.recovered.leaseRevision,
            });
          }
        },
        onError: (error) => console.error("Lease recovery cycle failed", error),
      }),
    ]);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

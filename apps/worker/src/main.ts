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
  TaskSubmitReviewHandler,
  semanticCommandDigest,
  type GatewayIds,
} from "@aop/command-bus";
import {
  PostgresAuthorizationResolver,
  PostgresContextManifestStore,
  PostgresRuntimeCommandStore,
} from "@aop/database";
import {
  OutboxWorker,
  PostgresNotifyPublisher,
  PostgresOutboxStore,
  runOutboxLoop,
} from "@aop/event-bus";
import type { CommandId } from "@aop/protocol";
import { GatewayKernelRuntimePort, RuntimeManager } from "@aop/runtime";
import { OpenAIRuntimeAdapter, createOpenAIModelPolicyResolver } from "@aop/runtime-openai";
import {
  DeterministicLeaseReaper,
  DeterministicScheduler,
  PostgresExpiredLeaseStore,
  PostgresSchedulerCandidateStore,
  deterministicPrefixedUlid,
  runLeaseReaperLoop,
  runSchedulerLoop,
} from "@aop/scheduler";

import { readOpenAIRuntimeWorkerConfig } from "./openai-runtime-config.js";
import { PostgresRuntimeContextProvider } from "./runtime-context-provider.js";
import { PostgresRuntimeExecutionStateReader } from "./runtime-control-state.js";
import {
  DeterministicRuntimeManifestIdSource,
  PostgresRuntimeCandidateStore,
  PostgresRuntimeExecutionPolicyResolver,
  RuntimeDispatcher,
  runRuntimeDispatcherLoop,
} from "./runtime-dispatcher.js";

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

function runtimeCommandIds(now: () => string) {
  return {
    nextCommandId: () => deterministicPrefixedUlid("cmd", now(), randomUUID()) as CommandId,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) throw new Error("DATABASE_URL is required");
  const openAIRuntime = readOpenAIRuntimeWorkerConfig(process.env);

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
      new TaskSubmitReviewHandler(clock),
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

  const runtimeDispatcher = openAIRuntime.enabled
    ? new RuntimeDispatcher(
        new PostgresRuntimeCandidateStore(pool, "runtime.openai", clock),
        new PostgresRuntimeExecutionPolicyResolver(pool, {
          supportedCommandTypes: ["task.submit_review"],
          maxOutputTokens: openAIRuntime.maxOutputTokens,
          now: clock,
        }),
        new RuntimeManager(
          new PostgresRuntimeContextProvider(new PostgresContextManifestStore(pool, clock)),
          new GatewayKernelRuntimePort(
            commandGateway,
            new PostgresRuntimeExecutionStateReader(pool),
            runtimeCommandIds(clock),
            clock,
          ),
          new OpenAIRuntimeAdapter({
            modelResolver: createOpenAIModelPolicyResolver(
              openAIRuntime.modelPolicies,
              openAIRuntime.defaultModel,
            ),
          }),
          clock,
        ),
        new DeterministicRuntimeManifestIdSource(),
        {
          maxConcurrent: openAIRuntime.maxConcurrent,
          maxContextTokens: openAIRuntime.maxContextTokens,
          requiredCompletionCommand: "task.submit_review",
        },
      )
    : undefined;

  if (runtimeDispatcher === undefined) {
    console.info("OpenAI Runtime dispatch disabled", { enableWith: "RUNTIME_OPENAI_ENABLED=true" });
  } else {
    console.info("OpenAI Runtime dispatch enabled", {
      maxConcurrent: openAIRuntime.maxConcurrent,
      maxContextTokens: openAIRuntime.maxContextTokens,
      maxOutputTokens: openAIRuntime.maxOutputTokens,
    });
  }

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
    const loops: Promise<void>[] = [
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
    ];

    if (runtimeDispatcher !== undefined) {
      loops.push(
        runRuntimeDispatcherLoop(runtimeDispatcher, {
          signal: controller.signal,
          idleDelayMs: openAIRuntime.idleDelayMs,
          onOutcomes: (outcomes) => {
            for (const outcome of outcomes) {
              if (outcome.status === "executed") {
                console.info("Runtime execution finished", {
                  organizationId: outcome.organizationId,
                  runId: outcome.runId,
                  status: outcome.report.status,
                  contextManifestId: outcome.report.contextManifestId,
                });
              } else if (outcome.status === "failed") {
                console.error("Runtime dispatch failed", {
                  organizationId: outcome.organizationId,
                  runId: outcome.runId,
                  reason: outcome.reason,
                });
              } else if (outcome.status === "contended") {
                console.info("Runtime dispatch contention", {
                  organizationId: outcome.organizationId,
                  runId: outcome.runId,
                  reason: outcome.reason,
                });
              } else {
                console.warn("Runtime dispatch skipped", {
                  organizationId: outcome.organizationId,
                  runId: outcome.runId,
                  reason: outcome.reason,
                });
              }
            }
          },
          onError: (error) => console.error("Runtime dispatch cycle failed", error),
        }),
      );
    }

    await Promise.all(loops);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

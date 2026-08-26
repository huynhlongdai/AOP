import { LeaseSchema, TaskRunSchema, type Lease, type TaskRun } from "@aop/protocol";

import { assertExpectedRevision, invariant } from "./errors.js";

const TERMINAL_RUN_STATUSES = new Set<TaskRun["status"]>(["succeeded", "failed", "lost", "cancelled"]);

export function prepareTaskRun(
  current: TaskRun,
  expectedRevision: number,
  runtimeId: string,
): TaskRun {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(current.status === "created", "Task run can only be prepared from created", {
    runId: current.id,
    status: current.status,
  });
  invariant(runtimeId.trim().length > 0, "Prepared task run requires runtimeId", { runId: current.id });

  return TaskRunSchema.parse({
    ...current,
    status: "preparing",
    runtimeId,
    revision: current.revision + 1,
  });
}

export function startTaskRun(current: TaskRun, expectedRevision: number, startedAt: string): TaskRun {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(current.status === "preparing", "Task run can only start from preparing", {
    runId: current.id,
    status: current.status,
  });
  invariant(current.runtimeId !== undefined, "Task run must be prepared with runtimeId before start", { runId: current.id });

  return TaskRunSchema.parse({
    ...current,
    status: "running",
    startedAt,
    heartbeatAt: startedAt,
    revision: current.revision + 1,
  });
}

export function finishTaskRun(
  current: TaskRun,
  expectedRevision: number,
  finishedAt: string,
  status: "succeeded" | "failed" | "cancelled",
  failureReason?: string,
): TaskRun {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(current.status === "running" || current.status === "paused", "Task run can only finish from running or paused", {
    runId: current.id,
    status: current.status,
  });
  invariant(status !== "failed" || (failureReason !== undefined && failureReason.trim().length > 0), "Failed task run requires failure reason", {
    runId: current.id,
  });
  invariant(status !== "succeeded" || failureReason === undefined, "Succeeded task run cannot include failure reason", {
    runId: current.id,
  });

  const candidate: TaskRun = {
    ...current,
    status,
    finishedAt,
    revision: current.revision + 1,
  };
  if (failureReason === undefined) delete candidate.failureReason;
  else candidate.failureReason = failureReason;
  return TaskRunSchema.parse(candidate);
}

export function heartbeatTaskRun(current: TaskRun, expectedRevision: number, heartbeatAt: string): TaskRun {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(!TERMINAL_RUN_STATUSES.has(current.status), "Cannot heartbeat a terminal task run", {
    runId: current.id,
    status: current.status,
  });

  return TaskRunSchema.parse({
    ...current,
    heartbeatAt,
    revision: current.revision + 1,
  });
}

export function markTaskRunLost(
  current: TaskRun,
  expectedRevision: number,
  finishedAt: string,
  failureReason: string,
): TaskRun {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(!TERMINAL_RUN_STATUSES.has(current.status), "Cannot mark a terminal task run as lost", {
    runId: current.id,
    status: current.status,
  });

  return TaskRunSchema.parse({
    ...current,
    status: "lost",
    finishedAt,
    failureReason,
    revision: current.revision + 1,
  });
}

export function heartbeatLease(
  current: Lease,
  expectedRevision: number,
  heartbeatAt: string,
  extendSeconds: number,
): Lease {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(current.status === "active", "Cannot heartbeat a non-active lease", {
    leaseId: current.id,
    status: current.status,
  });
  invariant(Date.parse(heartbeatAt) < Date.parse(current.expiresAt), "Cannot heartbeat an expired lease", {
    leaseId: current.id,
    expiresAt: current.expiresAt,
    heartbeatAt,
  });
  invariant(Number.isSafeInteger(extendSeconds) && extendSeconds >= 30 && extendSeconds <= 3_600, "Lease extension is outside v0 bounds", {
    extendSeconds,
  });

  return LeaseSchema.parse({
    ...current,
    expiresAt: new Date(Date.parse(heartbeatAt) + extendSeconds * 1_000).toISOString(),
    revision: current.revision + 1,
  });
}

export function releaseLease(current: Lease, expectedRevision: number): Lease {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(current.status === "active", "Cannot release a non-active lease", {
    leaseId: current.id,
    status: current.status,
  });
  return LeaseSchema.parse({ ...current, status: "released", revision: current.revision + 1 });
}

export function expireLease(current: Lease, expectedRevision: number, expiredAt: string): Lease {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(current.status === "active", "Cannot expire a non-active lease", {
    leaseId: current.id,
    status: current.status,
  });
  invariant(Date.parse(current.expiresAt) <= Date.parse(expiredAt), "Lease has not expired yet", {
    leaseId: current.id,
    expiresAt: current.expiresAt,
    expiredAt,
  });

  return LeaseSchema.parse({
    ...current,
    status: "expired",
    revision: current.revision + 1,
  });
}

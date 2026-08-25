import { LeaseSchema, TaskRunSchema, type Lease, type TaskRun } from "@aop/protocol";

import { assertExpectedRevision, invariant } from "./errors.js";

const TERMINAL_RUN_STATUSES = new Set<TaskRun["status"]>(["succeeded", "failed", "lost", "cancelled"]);

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

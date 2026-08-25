import {
  DomainError,
  expireLease,
  heartbeatLease,
  heartbeatTaskRun,
  markTaskRunLost,
  returnTaskToReadyAfterRunLoss,
} from "@aop/domain";
import {
  LeaseExpirePayloadSchema,
  LeaseHeartbeatPayloadSchema,
  type CommandEnvelope,
  type Lease,
  type LeaseId,
  type OrganizationId,
  type Task,
  type TaskRun,
} from "@aop/protocol";

import type { CommandHandler, CommandMutation, CommandTransaction } from "./contracts.js";

export interface LeaseExecutionBundle {
  readonly lease: Lease;
  readonly run: TaskRun;
  readonly task: Task;
}

export interface LeaseRecoveryTransaction extends CommandTransaction {
  lockLeaseExecution(organizationId: OrganizationId, leaseId: LeaseId): Promise<LeaseExecutionBundle | undefined>;
  persistLeaseHeartbeat(lease: Lease, run: TaskRun): Promise<void>;
  persistLeaseExpiry(lease: Lease, run: TaskRun, task: Task): Promise<void>;
}

function leaseRecoveryTransaction(transaction: CommandTransaction): LeaseRecoveryTransaction {
  const candidate = transaction as Partial<LeaseRecoveryTransaction>;
  if (
    typeof candidate.lockLeaseExecution !== "function" ||
    typeof candidate.persistLeaseHeartbeat !== "function" ||
    typeof candidate.persistLeaseExpiry !== "function"
  ) {
    throw new DomainError("internal_error", "Command store does not support lease recovery transactions");
  }
  return transaction as LeaseRecoveryTransaction;
}

function targetLeaseId(command: CommandEnvelope): LeaseId {
  if (command.target?.type !== "lease") {
    throw new DomainError("validation_error", `${command.type} requires a lease target`);
  }
  return command.target.id as LeaseId;
}

function expectedRevision(command: CommandEnvelope): number {
  if (command.expectedRevision === undefined) {
    throw new DomainError("validation_error", `${command.type} requires expectedRevision`);
  }
  return command.expectedRevision;
}

export class LeaseHeartbeatHandler implements CommandHandler {
  readonly type = "lease.heartbeat";
  readonly capability = "lease.heartbeat";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = LeaseHeartbeatPayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "lease.heartbeat payload is invalid", { issues: payload.error.issues });
    }

    const leaseId = targetLeaseId(command);
    const tx = leaseRecoveryTransaction(transaction);
    const bundle = await tx.lockLeaseExecution(command.organizationId, leaseId);
    if (bundle === undefined) throw new DomainError("not_found", "Lease was not found");

    const now = this.#now();
    const renewedLease = heartbeatLease(bundle.lease, expectedRevision(command), now, payload.data.extendSeconds);
    const heartbeatRun = heartbeatTaskRun(bundle.run, bundle.run.revision, now);
    await tx.persistLeaseHeartbeat(renewedLease, heartbeatRun);

    return {
      resultingRevision: renewedLease.revision,
      events: [
        {
          type: "lease.heartbeat",
          aggregate: { type: "lease", id: renewedLease.id },
          aggregateRevision: renewedLease.revision,
          correlationId: command.commandId,
          payload: {
            runId: heartbeatRun.id,
            runRevision: heartbeatRun.revision,
            heartbeatAt: now,
            expiresAt: renewedLease.expiresAt,
          },
        },
      ],
    };
  }
}

export class LeaseExpireHandler implements CommandHandler {
  readonly type = "lease.expire";
  readonly capability = "lease.expire";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = LeaseExpirePayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "lease.expire payload is invalid", { issues: payload.error.issues });
    }

    const leaseId = targetLeaseId(command);
    const tx = leaseRecoveryTransaction(transaction);
    const bundle = await tx.lockLeaseExecution(command.organizationId, leaseId);
    if (bundle === undefined) throw new DomainError("not_found", "Lease was not found");

    const now = this.#now();
    const expiredLease = expireLease(bundle.lease, expectedRevision(command), now);
    const lostRun = markTaskRunLost(bundle.run, bundle.run.revision, now, "lease_expired");
    const readyTask = returnTaskToReadyAfterRunLoss(bundle.task, bundle.task.revision, now);
    await tx.persistLeaseExpiry(expiredLease, lostRun, readyTask);

    return {
      resultingRevision: expiredLease.revision,
      events: [
        {
          type: "lease.expired",
          aggregate: { type: "lease", id: expiredLease.id },
          aggregateRevision: expiredLease.revision,
          correlationId: command.commandId,
          payload: { taskId: readyTask.id, runId: lostRun.id, expiredAt: now },
        },
        {
          type: "task_run.lost",
          aggregate: { type: "task_run", id: lostRun.id },
          aggregateRevision: lostRun.revision,
          correlationId: command.commandId,
          payload: { taskId: readyTask.id, leaseId: expiredLease.id, reason: "lease_expired" },
        },
        {
          type: "task.requeued",
          aggregate: { type: "task", id: readyTask.id },
          aggregateRevision: readyTask.revision,
          correlationId: command.commandId,
          payload: { lostRunId: lostRun.id, expiredLeaseId: expiredLease.id, nextAttempt: lostRun.attempt + 1 },
        },
      ],
    };
  }
}

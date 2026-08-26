import {
  DomainError,
  assertExpectedRevision,
  finishTaskRun,
  prepareTaskRun,
  releaseLease,
  returnTaskToReadyAfterRunTermination,
  startTask,
  startTaskRun,
} from "@aop/domain";
import {
  AOP_PROTOCOL_VERSION,
  RuntimeRunReportSchema,
  TaskRunFinishPayloadSchema,
  TaskRunPreparePayloadSchema,
  TaskRunStartPayloadSchema,
  type CommandEnvelope,
  type ContextManifestId,
  type Lease,
  type OrganizationId,
  type RuntimeRunReport,
  type Task,
  type TaskRun,
  type TaskRunId,
} from "@aop/protocol";

import type { CommandHandler, CommandMutation, CommandTransaction } from "./contracts.js";

export interface RuntimeExecutionBundle {
  readonly run: TaskRun;
  readonly task: Task;
  readonly lease: Lease;
}

export interface RuntimeLifecycleTransaction extends CommandTransaction {
  lockRuntimeExecution(organizationId: OrganizationId, runId: TaskRunId): Promise<RuntimeExecutionBundle | undefined>;
  contextManifestMatchesRun(
    organizationId: OrganizationId,
    contextManifestId: ContextManifestId,
    run: TaskRun,
  ): Promise<boolean>;
  persistRuntimePrepared(run: TaskRun): Promise<void>;
  persistRuntimeStarted(run: TaskRun, task: Task): Promise<void>;
  persistRuntimeFinished(
    run: TaskRun,
    lease: Lease,
    task: Task,
    taskRequeued: boolean,
    report: RuntimeRunReport,
  ): Promise<void>;
}

function runtimeLifecycleTransaction(transaction: CommandTransaction): RuntimeLifecycleTransaction {
  const candidate = transaction as Partial<RuntimeLifecycleTransaction>;
  if (
    typeof candidate.lockRuntimeExecution !== "function" ||
    typeof candidate.contextManifestMatchesRun !== "function" ||
    typeof candidate.persistRuntimePrepared !== "function" ||
    typeof candidate.persistRuntimeStarted !== "function" ||
    typeof candidate.persistRuntimeFinished !== "function"
  ) {
    throw new DomainError("internal_error", "Command store does not support Runtime lifecycle transactions");
  }
  return transaction as RuntimeLifecycleTransaction;
}

function assertRuntimeManager(command: CommandEnvelope): void {
  if (command.actor.type !== "system" || command.actor.id !== "runtime-manager") {
    throw new DomainError("forbidden", `${command.type} is reserved for system:runtime-manager`);
  }
}

function targetRunId(command: CommandEnvelope): TaskRunId {
  if (command.target?.type !== "task_run") {
    throw new DomainError("validation_error", `${command.type} requires a task_run target`);
  }
  return command.target.id as TaskRunId;
}

function expectedRevision(command: CommandEnvelope): number {
  if (command.expectedRevision === undefined) {
    throw new DomainError("validation_error", `${command.type} requires expectedRevision`);
  }
  return command.expectedRevision;
}

function assertBundleOwnership(bundle: RuntimeExecutionBundle): void {
  if (bundle.task.ownerAgentId !== bundle.run.agentId) {
    throw new DomainError("invariant_violation", "TaskRun agent no longer owns its Task", {
      runId: bundle.run.id,
      runAgentId: bundle.run.agentId,
      taskOwnerAgentId: bundle.task.ownerAgentId,
    });
  }
  if (bundle.lease.runId !== bundle.run.id || bundle.lease.taskId !== bundle.task.id || bundle.lease.agentId !== bundle.run.agentId) {
    throw new DomainError("invariant_violation", "Runtime execution Lease identity is inconsistent", {
      runId: bundle.run.id,
      leaseId: bundle.lease.id,
    });
  }
}

export class TaskRunPrepareHandler implements CommandHandler {
  readonly type = "task_run.prepare";
  readonly capability = "task_run.prepare";
  readonly requiresExpectedRevision = true;

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    assertRuntimeManager(command);
    const payload = TaskRunPreparePayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "task_run.prepare payload is invalid", { issues: payload.error.issues });
    }

    const tx = runtimeLifecycleTransaction(transaction);
    const bundle = await tx.lockRuntimeExecution(command.organizationId, targetRunId(command));
    if (bundle === undefined) throw new DomainError("not_found", "TaskRun was not found");
    assertBundleOwnership(bundle);
    if (bundle.lease.status !== "active") {
      throw new DomainError("invariant_violation", "TaskRun cannot prepare without an active Lease", {
        runId: bundle.run.id,
        leaseStatus: bundle.lease.status,
      });
    }
    if (payload.data.adapter !== bundle.run.runtimeType) {
      throw new DomainError("invariant_violation", "Runtime adapter does not match claimed TaskRun runtime type", {
        expectedAdapter: bundle.run.runtimeType,
        actualAdapter: payload.data.adapter,
      });
    }

    const prepared = prepareTaskRun(bundle.run, expectedRevision(command), payload.data.runtimeId);
    await tx.persistRuntimePrepared(prepared);

    return {
      resultingRevision: prepared.revision,
      events: [
        {
          type: "task_run.prepared",
          aggregate: { type: "task_run", id: prepared.id },
          aggregateRevision: prepared.revision,
          correlationId: command.commandId,
          payload: {
            taskId: prepared.taskId,
            agentId: prepared.agentId,
            runtimeId: payload.data.runtimeId,
            adapter: payload.data.adapter,
            provider: payload.data.provider ?? null,
            model: payload.data.model ?? null,
            traceRefs: payload.data.traceRefs,
          },
        },
      ],
    };
  }
}

export class TaskRunStartHandler implements CommandHandler {
  readonly type = "task_run.start";
  readonly capability = "task_run.start";
  readonly requiresExpectedRevision = true;
  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    assertRuntimeManager(command);
    const payload = TaskRunStartPayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "task_run.start payload is invalid", { issues: payload.error.issues });
    }

    const tx = runtimeLifecycleTransaction(transaction);
    const bundle = await tx.lockRuntimeExecution(command.organizationId, targetRunId(command));
    if (bundle === undefined) throw new DomainError("not_found", "TaskRun was not found");
    assertBundleOwnership(bundle);
    if (bundle.lease.status !== "active") {
      throw new DomainError("invariant_violation", "TaskRun cannot start without an active Lease", {
        runId: bundle.run.id,
        leaseStatus: bundle.lease.status,
      });
    }

    const startedAt = this.#now();
    const run = startTaskRun(bundle.run, expectedRevision(command), startedAt);
    const task = startTask(bundle.task, payload.data.taskExpectedRevision, startedAt);
    await tx.persistRuntimeStarted(run, task);

    return {
      resultingRevision: run.revision,
      events: [
        {
          type: "task_run.started",
          aggregate: { type: "task_run", id: run.id },
          aggregateRevision: run.revision,
          correlationId: command.commandId,
          payload: { taskId: task.id, runtimeId: run.runtimeId, startedAt },
        },
        {
          type: "task.started",
          aggregate: { type: "task", id: task.id },
          aggregateRevision: task.revision,
          correlationId: command.commandId,
          payload: { runId: run.id, agentId: run.agentId },
        },
      ],
    };
  }
}

export class TaskRunFinishHandler implements CommandHandler {
  readonly type = "task_run.finish";
  readonly capability = "task_run.finish";
  readonly requiresExpectedRevision = true;
  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    assertRuntimeManager(command);
    const payload = TaskRunFinishPayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "task_run.finish payload is invalid", { issues: payload.error.issues });
    }

    const tx = runtimeLifecycleTransaction(transaction);
    const bundle = await tx.lockRuntimeExecution(command.organizationId, targetRunId(command));
    if (bundle === undefined) throw new DomainError("not_found", "TaskRun was not found");
    assertBundleOwnership(bundle);
    if (bundle.lease.status !== "active") {
      throw new DomainError("invariant_violation", "TaskRun cannot finish without an active Lease", {
        runId: bundle.run.id,
        leaseStatus: bundle.lease.status,
      });
    }
    if (payload.data.runtimeId !== bundle.run.runtimeId) {
      throw new DomainError("invariant_violation", "Runtime finish identity does not match prepared runtime", {
        runId: bundle.run.id,
        expectedRuntimeId: bundle.run.runtimeId ?? null,
        actualRuntimeId: payload.data.runtimeId,
      });
    }
    if (payload.data.adapter !== bundle.run.runtimeType) {
      throw new DomainError("invariant_violation", "Runtime finish adapter does not match claimed runtime type", {
        expectedAdapter: bundle.run.runtimeType,
        actualAdapter: payload.data.adapter,
      });
    }
    if (
      payload.data.contextManifestId !== undefined &&
      !(await tx.contextManifestMatchesRun(command.organizationId, payload.data.contextManifestId, bundle.run))
    ) {
      throw new DomainError("invariant_violation", "Runtime finish Context Manifest is not bound to this TaskRun", {
        runId: bundle.run.id,
        contextManifestId: payload.data.contextManifestId,
      });
    }

    const finishedAt = this.#now();
    const run = finishTaskRun(
      bundle.run,
      expectedRevision(command),
      finishedAt,
      payload.data.status,
      payload.data.failureReason,
    );
    const lease = releaseLease(bundle.lease, bundle.lease.revision);

    let task = bundle.task;
    let taskRequeued = false;
    if (payload.data.status === "succeeded") {
      assertExpectedRevision(task.revision, payload.data.taskExpectedRevision);
      if (task.state === "leased" || task.state === "running") {
        throw new DomainError(
          "invariant_violation",
          "Successful TaskRun must commit Task state before finishing, normally by submitting for review",
          { runId: run.id, taskId: task.id, taskState: task.state },
        );
      }
    } else if (task.state === "leased" || task.state === "running") {
      task = returnTaskToReadyAfterRunTermination(task, payload.data.taskExpectedRevision, finishedAt);
      taskRequeued = true;
    } else {
      assertExpectedRevision(task.revision, payload.data.taskExpectedRevision);
    }

    if (run.startedAt === undefined || run.finishedAt === undefined || run.runtimeId === undefined) {
      throw new DomainError("invariant_violation", "Finished TaskRun is missing immutable Runtime report identity", {
        runId: run.id,
      });
    }

    const report = RuntimeRunReportSchema.parse({
      schemaVersion: 1,
      protocolVersion: AOP_PROTOCOL_VERSION,
      organizationId: run.organizationId,
      taskId: run.taskId,
      runId: run.id,
      agentId: run.agentId,
      attempt: run.attempt,
      ...(payload.data.contextManifestId === undefined ? {} : { contextManifestId: payload.data.contextManifestId }),
      runtimeId: run.runtimeId,
      adapter: payload.data.adapter,
      ...(payload.data.provider === undefined ? {} : { provider: payload.data.provider }),
      ...(payload.data.model === undefined ? {} : { model: payload.data.model }),
      status: run.status,
      usage: payload.data.usage,
      traceRefs: payload.data.traceRefs,
      commandOutcomes: payload.data.commandOutcomes,
      ...(payload.data.failureReason === undefined ? {} : { failureReason: payload.data.failureReason }),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: finishedAt,
    });

    await tx.persistRuntimeFinished(run, lease, task, taskRequeued, report);

    const events: CommandMutation["events"] = [
      {
        type: `task_run.${run.status}`,
        aggregate: { type: "task_run", id: run.id },
        aggregateRevision: run.revision,
        correlationId: command.commandId,
        payload: {
          taskId: run.taskId,
          finishedAt,
          contextManifestId: payload.data.contextManifestId ?? null,
          usage: payload.data.usage,
          traceRefs: payload.data.traceRefs,
          commandOutcomeCount: payload.data.commandOutcomes.length,
          runReport: { type: "task_run", id: run.id },
          failureReason: payload.data.failureReason ?? null,
        },
      },
      {
        type: "lease.released",
        aggregate: { type: "lease", id: lease.id },
        aggregateRevision: lease.revision,
        correlationId: command.commandId,
        payload: { taskId: task.id, runId: run.id },
      },
    ];
    if (taskRequeued) {
      return {
        resultingRevision: run.revision,
        events: [
          ...events,
          {
            type: "task.requeued",
            aggregate: { type: "task", id: task.id },
            aggregateRevision: task.revision,
            correlationId: command.commandId,
            payload: { terminatedRunId: run.id, reason: run.status, nextAttempt: run.attempt + 1 },
          },
        ],
      };
    }
    return { resultingRevision: run.revision, events };
  }
}

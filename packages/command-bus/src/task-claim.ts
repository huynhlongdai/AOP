import { DomainError, leaseTask } from "@aop/domain";
import {
  LeaseSchema,
  TaskClaimPayloadSchema,
  TaskRunSchema,
  TaskSchema,
  type AgentId,
  type ArtifactVersionId,
  type CommandEnvelope,
  type Lease,
  type OrganizationId,
  type Task,
  type TaskId,
  type TaskRun,
} from "@aop/protocol";

import type { CommandHandler, CommandMutation, CommandTransaction } from "./contracts.js";

export interface TaskClaimAgentProfile {
  readonly active: boolean;
  readonly capabilities: readonly string[];
  readonly activeLeaseCount: number;
}

export interface TaskClaimTransaction extends CommandTransaction {
  lockTask(organizationId: OrganizationId, taskId: TaskId): Promise<Task | undefined>;
  hardDependencyBlockers(organizationId: OrganizationId, taskId: TaskId): Promise<readonly TaskId[]>;
  staleRequiredArtifactInputs(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly ArtifactVersionId[]>;
  getAgentSchedulingProfile(organizationId: OrganizationId, agentId: AgentId): Promise<TaskClaimAgentProfile | undefined>;
  nextTaskAttempt(organizationId: OrganizationId, taskId: TaskId): Promise<number>;
  persistTaskClaim(task: Task, run: TaskRun, lease: Lease): Promise<void>;
}

function taskClaimTransaction(transaction: CommandTransaction): TaskClaimTransaction {
  const candidate = transaction as Partial<TaskClaimTransaction>;
  if (
    typeof candidate.lockTask !== "function" ||
    typeof candidate.hardDependencyBlockers !== "function" ||
    typeof candidate.staleRequiredArtifactInputs !== "function" ||
    typeof candidate.getAgentSchedulingProfile !== "function" ||
    typeof candidate.nextTaskAttempt !== "function" ||
    typeof candidate.persistTaskClaim !== "function"
  ) {
    throw new DomainError("internal_error", "Command store does not support task.claim transactions");
  }
  return transaction as TaskClaimTransaction;
}

function targetTaskId(command: CommandEnvelope): TaskId {
  if (command.target?.type !== "task") {
    throw new DomainError("validation_error", "task.claim requires a task target");
  }
  return command.target.id as TaskId;
}

function assertCapabilities(required: readonly string[], available: readonly string[]): void {
  const set = new Set(available);
  const missing = required.filter((capability) => !set.has(capability));
  if (missing.length > 0) {
    throw new DomainError("invariant_violation", "Agent does not satisfy task capabilities", { missingCapabilities: missing });
  }
}

export class TaskClaimHandler implements CommandHandler {
  readonly type = "task.claim";
  readonly capability = "task.claim";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = TaskClaimPayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "task.claim payload is invalid", { issues: payload.error.issues });
    }

    const taskId = targetTaskId(command);
    const tx = taskClaimTransaction(transaction);
    const task = await tx.lockTask(command.organizationId, taskId);
    if (task === undefined) {
      throw new DomainError("not_found", "Task was not found");
    }

    if (command.expectedRevision === undefined) {
      throw new DomainError("validation_error", "task.claim requires expectedRevision");
    }

    if (task.ownerAgentId !== undefined && task.ownerAgentId !== payload.data.agentId) {
      throw new DomainError("invariant_violation", "Task is already owned by another agent", {
        ownerAgentId: task.ownerAgentId,
        requestedAgentId: payload.data.agentId,
      });
    }

    const blockers = await tx.hardDependencyBlockers(command.organizationId, taskId);
    if (blockers.length > 0) {
      throw new DomainError("invariant_violation", "Task has incomplete hard dependencies", { blockerTaskIds: blockers });
    }

    const staleInputs = await tx.staleRequiredArtifactInputs(command.organizationId, taskId);
    if (staleInputs.length > 0) {
      throw new DomainError("invariant_violation", "Task has stale required Artifact inputs", {
        staleArtifactVersionIds: [...staleInputs],
      });
    }

    const agent = await tx.getAgentSchedulingProfile(command.organizationId, payload.data.agentId);
    if (agent === undefined || !agent.active) {
      throw new DomainError("invariant_violation", "Agent is not an active organization member", {
        agentId: payload.data.agentId,
      });
    }
    assertCapabilities(task.requiredCapabilities, agent.capabilities);
    if (agent.activeLeaseCount > 0) {
      throw new DomainError("invariant_violation", "Agent has no available v0 scheduling capacity", {
        agentId: payload.data.agentId,
        activeLeaseCount: agent.activeLeaseCount,
      });
    }

    const nextAttempt = await tx.nextTaskAttempt(command.organizationId, taskId);
    if (payload.data.attempt !== nextAttempt) {
      throw new DomainError("revision_conflict", "Task attempt changed while claim was being prepared", {
        expectedAttempt: payload.data.attempt,
        actualAttempt: nextAttempt,
      });
    }

    const now = this.#now();
    const leased = TaskSchema.parse({
      ...leaseTask(task, command.expectedRevision, now),
      ownerAgentId: payload.data.agentId,
    });

    const run = TaskRunSchema.parse({
      id: payload.data.runId,
      organizationId: command.organizationId,
      taskId,
      agentId: payload.data.agentId,
      attempt: payload.data.attempt,
      status: "created",
      runtimeType: payload.data.runtimeType,
      workspaceId: payload.data.workspaceId,
      revision: 0,
    });

    const expiresAt = new Date(Date.parse(now) + payload.data.leaseSeconds * 1_000).toISOString();
    const lease = LeaseSchema.parse({
      id: payload.data.leaseId,
      organizationId: command.organizationId,
      taskId,
      runId: payload.data.runId,
      agentId: payload.data.agentId,
      status: "active",
      attempt: payload.data.attempt,
      acquiredAt: now,
      expiresAt,
      heartbeatIntervalSeconds: payload.data.heartbeatIntervalSeconds,
      revision: 0,
    });

    await tx.persistTaskClaim(leased, run, lease);

    return {
      resultingRevision: leased.revision,
      events: [
        {
          type: "task.leased",
          aggregate: { type: "task", id: taskId },
          aggregateRevision: leased.revision,
          correlationId: command.commandId,
          payload: { agentId: payload.data.agentId, runId: run.id, leaseId: lease.id, attempt: run.attempt },
        },
        {
          type: "task_run.created",
          aggregate: { type: "task_run", id: run.id },
          aggregateRevision: run.revision,
          correlationId: command.commandId,
          payload: { taskId, agentId: run.agentId, attempt: run.attempt, runtimeType: run.runtimeType },
        },
        {
          type: "lease.acquired",
          aggregate: { type: "lease", id: lease.id },
          aggregateRevision: lease.revision,
          correlationId: command.commandId,
          payload: { taskId, runId: run.id, agentId: lease.agentId, expiresAt: lease.expiresAt },
        },
      ],
    };
  }
}

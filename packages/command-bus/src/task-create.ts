import { createTask, DomainError } from "@aop/domain";
import {
  TaskCreatePayloadSchema,
  TaskDependencySchema,
  type AgentId,
  type ArtifactVersionId,
  type CommandEnvelope,
  type GoalStatus,
  type OrganizationId,
  type Task,
  type TaskArtifactInput,
  type TaskCreateArtifactInput,
  type TaskDependency,
  type TaskId,
} from "@aop/protocol";

import type { CommandHandler, CommandMutation, CommandTransaction } from "./contracts.js";

export interface TaskCreateAgentProfile {
  readonly active: boolean;
  readonly capabilities: readonly string[];
  readonly activeRoleCount: number;
}

export interface TaskCreateArtifactResolution {
  readonly inputs: readonly TaskArtifactInput[];
  readonly invalid: readonly {
    readonly artifactVersionId: ArtifactVersionId;
    readonly reason: "not_found" | "unreviewed" | "required_not_current";
  }[];
}

export interface TaskCreateTransaction extends CommandTransaction {
  lockTask(organizationId: OrganizationId, taskId: TaskId): Promise<Task | undefined>;
  lockTaskCreateIdentity(organizationId: OrganizationId, taskId: TaskId): Promise<boolean>;
  goalStatus(organizationId: OrganizationId, goalId: Task["goalId"]): Promise<GoalStatus | undefined>;
  getTaskCreateAgentProfile(
    organizationId: OrganizationId,
    agentId: AgentId,
    now: string,
  ): Promise<TaskCreateAgentProfile | undefined>;
  resolveTaskCreateArtifactInputs(
    organizationId: OrganizationId,
    inputs: readonly TaskCreateArtifactInput[],
  ): Promise<TaskCreateArtifactResolution>;
  existingTaskIds(organizationId: OrganizationId, taskIds: readonly TaskId[]): Promise<readonly TaskId[]>;
  persistTaskCreate(parentTaskId: TaskId, task: Task, dependencies: readonly TaskDependency[]): Promise<void>;
}

function taskCreateTransaction(transaction: CommandTransaction): TaskCreateTransaction {
  const candidate = transaction as Partial<TaskCreateTransaction>;
  if (
    typeof candidate.lockTask !== "function" ||
    typeof candidate.lockTaskCreateIdentity !== "function" ||
    typeof candidate.goalStatus !== "function" ||
    typeof candidate.getTaskCreateAgentProfile !== "function" ||
    typeof candidate.resolveTaskCreateArtifactInputs !== "function" ||
    typeof candidate.existingTaskIds !== "function" ||
    typeof candidate.persistTaskCreate !== "function"
  ) {
    throw new DomainError("internal_error", "Command store does not support task.create transactions");
  }
  return transaction as TaskCreateTransaction;
}

function targetParentTaskId(command: CommandEnvelope): TaskId {
  if (command.target?.type !== "task") {
    throw new DomainError("validation_error", "task.create requires the executing parent Task as target");
  }
  return command.target.id as TaskId;
}

function assertCapabilities(required: readonly string[], available: readonly string[], agentId: AgentId): void {
  const availableSet = new Set(available);
  const missing = required.filter((capability) => !availableSet.has(capability));
  if (missing.length > 0) {
    throw new DomainError("invariant_violation", "Assigned Task owner does not satisfy required capabilities", {
      agentId,
      missingCapabilities: missing,
    });
  }
}

export class TaskCreateHandler implements CommandHandler {
  readonly type = "task.create";
  readonly capability = "task.create";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = TaskCreatePayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "task.create payload is invalid", { issues: payload.error.issues });
    }
    if (command.expectedRevision === undefined) {
      throw new DomainError("validation_error", "task.create requires the parent Task expectedRevision");
    }
    if (command.actor.type !== "agent") {
      throw new DomainError("forbidden", "Runtime task.create is restricted to Agent decomposition");
    }

    const tx = taskCreateTransaction(transaction);
    const parentTaskId = targetParentTaskId(command);
    const parent = await tx.lockTask(command.organizationId, parentTaskId);
    if (parent === undefined) throw new DomainError("not_found", "Parent Task was not found", { parentTaskId });
    if (parent.revision !== command.expectedRevision) {
      throw new DomainError("revision_conflict", "Parent Task changed before decomposition", {
        parentTaskId,
        expectedRevision: command.expectedRevision,
        actualRevision: parent.revision,
      });
    }
    if (parent.state !== "running") {
      throw new DomainError("invariant_violation", "Agent may create child Tasks only while its parent Task is running", {
        parentTaskId,
        parentState: parent.state,
      });
    }
    if (parent.ownerAgentId !== command.actor.id) {
      throw new DomainError("forbidden", "Only the current parent Task owner may decompose it", {
        parentTaskId,
        ownerAgentId: parent.ownerAgentId ?? null,
        actorAgentId: command.actor.id,
      });
    }

    const goalStatus = await tx.goalStatus(command.organizationId, parent.goalId);
    if (goalStatus !== "active") {
      throw new DomainError("invariant_violation", "Child Task requires the parent Goal to remain active", {
        goalId: parent.goalId,
        goalStatus: goalStatus ?? null,
      });
    }

    if (payload.data.taskId === parent.id) {
      throw new DomainError("validation_error", "Child Task ID cannot equal its parent Task ID");
    }
    if (await tx.lockTaskCreateIdentity(command.organizationId, payload.data.taskId)) {
      throw new DomainError("conflict", "Child Task ID already exists", { taskId: payload.data.taskId });
    }

    const now = this.#now();
    const [owner, reviewer] = await Promise.all([
      tx.getTaskCreateAgentProfile(command.organizationId, payload.data.ownerAgentId, now),
      tx.getTaskCreateAgentProfile(command.organizationId, payload.data.reviewerAgentId, now),
    ]);
    if (owner === undefined || !owner.active || owner.activeRoleCount < 1) {
      throw new DomainError("invariant_violation", "Assigned Task owner is not an active role-bearing Organization member", {
        agentId: payload.data.ownerAgentId,
      });
    }
    if (reviewer === undefined || !reviewer.active || reviewer.activeRoleCount < 1) {
      throw new DomainError("invariant_violation", "Assigned Task reviewer is not an active role-bearing Organization member", {
        agentId: payload.data.reviewerAgentId,
      });
    }
    assertCapabilities(payload.data.requiredCapabilities, owner.capabilities, payload.data.ownerAgentId);

    const artifactResolution = await tx.resolveTaskCreateArtifactInputs(command.organizationId, payload.data.inputs);
    if (artifactResolution.invalid.length > 0) {
      throw new DomainError("invariant_violation", "Child Task contains invalid Artifact inputs", {
        invalidArtifactInputs: artifactResolution.invalid,
      });
    }

    const dependencyIds = payload.data.dependencies.map((dependency) => dependency.taskId);
    if (dependencyIds.length > 0) {
      const existing = new Set(await tx.existingTaskIds(command.organizationId, dependencyIds));
      const missing = dependencyIds.filter((taskId) => !existing.has(taskId));
      if (missing.length > 0) {
        throw new DomainError("scope_mismatch", "Child Task dependency does not exist in the Organization", {
          missingTaskIds: missing,
        });
      }
    }

    const child = createTask({
      id: payload.data.taskId,
      organizationId: command.organizationId,
      goalId: parent.goalId,
      title: payload.data.title,
      objective: payload.data.objective,
      createdBy: command.actor,
      ownerAgentId: payload.data.ownerAgentId,
      reviewerAgentId: payload.data.reviewerAgentId,
      priority: payload.data.priority,
      state: "ready",
      scope: payload.data.scope,
      inputs: [...artifactResolution.inputs],
      deliverables: payload.data.deliverables,
      acceptanceCriteria: payload.data.acceptanceCriteria,
      requiredCapabilities: payload.data.requiredCapabilities,
      constraints: payload.data.constraints,
      budget: payload.data.budget,
      createdAt: now,
      updatedAt: now,
    });
    const dependencies = payload.data.dependencies.map((dependency) =>
      TaskDependencySchema.parse({
        organizationId: command.organizationId,
        taskId: child.id,
        dependsOnTaskId: dependency.taskId,
        type: dependency.type,
      }),
    );

    await tx.persistTaskCreate(parent.id, child, dependencies);

    return {
      resultingRevision: child.revision,
      events: [
        {
          type: "task.created",
          aggregate: { type: "task", id: child.id },
          aggregateRevision: child.revision,
          correlationId: command.commandId,
          payload: {
            parentTaskId: parent.id,
            goalId: child.goalId,
            ownerAgentId: child.ownerAgentId,
            reviewerAgentId: child.reviewerAgentId,
            dependencyCount: dependencies.length,
            inputCount: child.inputs.length,
          },
        },
      ],
    };
  }
}

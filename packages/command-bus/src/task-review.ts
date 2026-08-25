import {
  completeTaskFromReview,
  createReview,
  DomainError,
  failTask,
  requestTaskRework,
  resolveReview,
  submitTaskForReview,
} from "@aop/domain";
import {
  LeaseSchema,
  ReviewResolvePayloadSchema,
  TaskRunSchema,
  TaskSubmitReviewPayloadSchema,
  type ArtifactVersionId,
  type CommandEnvelope,
  type Lease,
  type OrganizationId,
  type Review,
  type ReviewId,
  type Task,
  type TaskId,
  type TaskRun,
} from "@aop/protocol";

import type { CommandHandler, CommandMutation, CommandTransaction, EventDraft } from "./contracts.js";

export interface ActiveTaskExecution {
  readonly run: TaskRun;
  readonly lease: Lease;
}

export interface TaskReviewTransaction extends CommandTransaction {
  lockTask(organizationId: OrganizationId, taskId: TaskId): Promise<Task | undefined>;
  staleRequiredArtifactInputs(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly ArtifactVersionId[]>;
  lockActiveTaskExecution(organizationId: OrganizationId, taskId: TaskId): Promise<ActiveTaskExecution | undefined>;
  persistTaskReviewSubmission(task: Task, review: Review, run: TaskRun, lease: Lease): Promise<void>;
  lockReview(organizationId: OrganizationId, reviewId: ReviewId): Promise<Review | undefined>;
  persistReviewResolution(review: Review, task: Task): Promise<void>;
}

function taskReviewTransaction(transaction: CommandTransaction): TaskReviewTransaction {
  const candidate = transaction as Partial<TaskReviewTransaction>;
  if (
    typeof candidate.lockTask !== "function" ||
    typeof candidate.staleRequiredArtifactInputs !== "function" ||
    typeof candidate.lockActiveTaskExecution !== "function" ||
    typeof candidate.persistTaskReviewSubmission !== "function" ||
    typeof candidate.lockReview !== "function" ||
    typeof candidate.persistReviewResolution !== "function"
  ) {
    throw new DomainError("internal_error", "Command store does not support Task review transactions");
  }
  return transaction as TaskReviewTransaction;
}

function targetTaskId(command: CommandEnvelope): TaskId {
  if (command.target?.type !== "task") {
    throw new DomainError("validation_error", "task.submit_review requires a Task target");
  }
  return command.target.id as TaskId;
}

function targetReviewId(command: CommandEnvelope): ReviewId {
  if (command.target?.type !== "review") {
    throw new DomainError("validation_error", "review.resolve requires a Review target");
  }
  return command.target.id as ReviewId;
}

function assertSamePrincipal(
  actual: CommandEnvelope["actor"],
  expected: Review["reviewer"],
  message: string,
): void {
  if (actual.type !== expected.type || actual.id !== expected.id) {
    throw new DomainError("forbidden", message, {
      expectedReviewer: expected,
      actualActor: actual,
    });
  }
}

async function assertEvidenceScope(
  command: CommandEnvelope,
  transaction: CommandTransaction,
  evidence: readonly Review["evidence"][number][],
): Promise<void> {
  for (const resource of evidence) {
    if (!(await transaction.resourceBelongsToOrganization(command.organizationId, resource))) {
      throw new DomainError("scope_mismatch", "Review evidence does not belong to the command Organization", {
        resource,
      });
    }
  }
}

export class TaskSubmitReviewHandler implements CommandHandler {
  readonly type = "task.submit_review";
  readonly capability = "task.submit_review";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = TaskSubmitReviewPayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "task.submit_review payload is invalid", {
        issues: payload.error.issues,
      });
    }
    if (command.expectedRevision === undefined) {
      throw new DomainError("validation_error", "task.submit_review requires expectedRevision");
    }

    const taskId = targetTaskId(command);
    const tx = taskReviewTransaction(transaction);
    const task = await tx.lockTask(command.organizationId, taskId);
    if (task === undefined) throw new DomainError("not_found", "Task was not found", { taskId });

    if (command.actor.type !== "agent" || task.ownerAgentId !== command.actor.id) {
      throw new DomainError("forbidden", "Only the current Task owner Agent can submit work for review", {
        taskId,
        ownerAgentId: task.ownerAgentId ?? null,
        actor: command.actor,
      });
    }
    if (task.reviewerAgentId === undefined) {
      throw new DomainError("invariant_violation", "Task has no reviewer Agent assigned", { taskId });
    }
    if (task.reviewerAgentId === task.ownerAgentId) {
      throw new DomainError("invariant_violation", "Task owner cannot review its own work", {
        taskId,
        agentId: task.ownerAgentId,
      });
    }

    const staleInputs = await tx.staleRequiredArtifactInputs(command.organizationId, taskId);
    if (staleInputs.length > 0) {
      throw new DomainError("invariant_violation", "Task cannot enter review with stale required Artifact inputs", {
        staleArtifactVersionIds: [...staleInputs],
      });
    }

    const execution = await tx.lockActiveTaskExecution(command.organizationId, taskId);
    if (execution === undefined) {
      throw new DomainError("invariant_violation", "Running Task has no active Run and Lease", { taskId });
    }
    if (execution.run.agentId !== command.actor.id || execution.lease.agentId !== command.actor.id) {
      throw new DomainError("invariant_violation", "Active execution is owned by another Agent", {
        taskId,
        runAgentId: execution.run.agentId,
        leaseAgentId: execution.lease.agentId,
        actorAgentId: command.actor.id,
      });
    }

    const now = this.#now();
    const submittedTask = submitTaskForReview(task, command.expectedRevision, now);
    const review = createReview({
      id: payload.data.reviewId,
      organizationId: command.organizationId,
      subject: { type: "task", id: taskId },
      reviewer: { type: "agent", id: task.reviewerAgentId },
      criteria: payload.data.criteria,
      evidence: [],
      result: "pending",
      findings: [],
      createdAt: now,
    });
    const run = TaskRunSchema.parse({
      ...execution.run,
      status: "succeeded",
      finishedAt: now,
      revision: execution.run.revision + 1,
    });
    const lease = LeaseSchema.parse({
      ...execution.lease,
      status: "released",
      revision: execution.lease.revision + 1,
    });

    await tx.persistTaskReviewSubmission(submittedTask, review, run, lease);

    return {
      resultingRevision: submittedTask.revision,
      events: [
        {
          type: "task.review_submitted",
          aggregate: { type: "task", id: taskId },
          aggregateRevision: submittedTask.revision,
          correlationId: command.commandId,
          payload: { reviewId: review.id, reviewer: review.reviewer, runId: run.id },
        },
        {
          type: "review.created",
          aggregate: { type: "review", id: review.id },
          aggregateRevision: review.revision,
          correlationId: command.commandId,
          payload: { subject: review.subject, reviewer: review.reviewer, criteriaCount: review.criteria.length },
        },
        {
          type: "task_run.succeeded",
          aggregate: { type: "task_run", id: run.id },
          aggregateRevision: run.revision,
          correlationId: command.commandId,
          payload: { taskId, attempt: run.attempt },
        },
        {
          type: "lease.released",
          aggregate: { type: "lease", id: lease.id },
          aggregateRevision: lease.revision,
          correlationId: command.commandId,
          payload: { taskId, runId: run.id, reason: "submitted_for_review" },
        },
      ],
    };
  }
}

export class ReviewResolveHandler implements CommandHandler {
  readonly type = "review.resolve";
  readonly capability = "review.resolve";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = ReviewResolvePayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "review.resolve payload is invalid", {
        issues: payload.error.issues,
      });
    }
    if (command.expectedRevision === undefined) {
      throw new DomainError("validation_error", "review.resolve requires expectedRevision");
    }

    const reviewId = targetReviewId(command);
    const tx = taskReviewTransaction(transaction);
    const review = await tx.lockReview(command.organizationId, reviewId);
    if (review === undefined) throw new DomainError("not_found", "Review was not found", { reviewId });
    if (review.subject.type !== "task") {
      throw new DomainError("invariant_violation", "review.resolve currently supports Task reviews only", {
        reviewId,
        subject: review.subject,
      });
    }
    assertSamePrincipal(command.actor, review.reviewer, "Only the assigned reviewer can resolve this Review");
    await assertEvidenceScope(command, transaction, payload.data.evidence);

    const taskId = review.subject.id as TaskId;
    const task = await tx.lockTask(command.organizationId, taskId);
    if (task === undefined) throw new DomainError("not_found", "Reviewed Task was not found", { taskId });
    if (task.reviewerAgentId === undefined || review.reviewer.type !== "agent" || task.reviewerAgentId !== review.reviewer.id) {
      throw new DomainError("invariant_violation", "Review reviewer no longer matches the Task Work Contract", {
        taskId,
        taskReviewerAgentId: task.reviewerAgentId ?? null,
        reviewReviewer: review.reviewer,
      });
    }

    if (payload.data.result === "pass") {
      const staleInputs = await tx.staleRequiredArtifactInputs(command.organizationId, taskId);
      if (staleInputs.length > 0) {
        throw new DomainError("invariant_violation", "Task cannot complete with stale required Artifact inputs", {
          staleArtifactVersionIds: [...staleInputs],
        });
      }
    }

    const now = this.#now();
    const resolvedReview = resolveReview(
      review,
      payload.data.result,
      payload.data.evidence,
      payload.data.findings,
      command.expectedRevision,
      now,
    );

    const nextTask =
      payload.data.result === "pass"
        ? completeTaskFromReview(task, payload.data.taskExpectedRevision, now)
        : payload.data.result === "rework"
          ? requestTaskRework(task, payload.data.taskExpectedRevision, now)
          : failTask(task, payload.data.taskExpectedRevision, now);

    await tx.persistReviewResolution(resolvedReview, nextTask);

    const taskEvent: EventDraft =
      payload.data.result === "pass"
        ? {
            type: "task.completed",
            aggregate: { type: "task", id: taskId },
            aggregateRevision: nextTask.revision,
            correlationId: command.commandId,
            payload: { reviewId, evidenceCount: resolvedReview.evidence.length },
          }
        : payload.data.result === "rework"
          ? {
              type: "task.rework_requested",
              aggregate: { type: "task", id: taskId },
              aggregateRevision: nextTask.revision,
              correlationId: command.commandId,
              payload: { reviewId, findings: resolvedReview.findings },
            }
          : {
              type: "task.failed",
              aggregate: { type: "task", id: taskId },
              aggregateRevision: nextTask.revision,
              correlationId: command.commandId,
              payload: { reviewId, findings: resolvedReview.findings, reason: "review_failed" },
            };

    return {
      resultingRevision: resolvedReview.revision,
      events: [
        {
          type: "review.resolved",
          aggregate: { type: "review", id: reviewId },
          aggregateRevision: resolvedReview.revision,
          correlationId: command.commandId,
          payload: {
            subject: resolvedReview.subject,
            result: resolvedReview.result,
            evidenceCount: resolvedReview.evidence.length,
            findingCount: resolvedReview.findings.length,
          },
        },
        taskEvent,
      ],
    };
  }
}

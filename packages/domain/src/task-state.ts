import {
  TaskSchema,
  type Task,
  type TaskBlockReason,
  type TaskState,
} from "@aop/protocol";

import { assertExpectedRevision, invariant } from "./errors.js";

export type TaskCreateInput = Omit<Task, "revision">;

const TERMINAL_STATES = new Set<TaskState>(["completed", "failed", "cancelled", "rejected"]);

function assertCurrentState(task: Task, allowed: readonly TaskState[], action: string): void {
  invariant(!TERMINAL_STATES.has(task.state), `Cannot ${action} a terminal task`, {
    taskId: task.id,
    state: task.state,
  });
  invariant(allowed.includes(task.state), `Cannot ${action} task from state ${task.state}`, {
    taskId: task.id,
    state: task.state,
    allowed,
  });
}

function transitionBase(
  current: Task,
  next: TaskState,
  expectedRevision: number,
  updatedAt: string,
): Task {
  assertExpectedRevision(current.revision, expectedRevision);

  const candidate: Task = { ...current };
  candidate.state = next;
  candidate.revision = current.revision + 1;
  candidate.updatedAt = updatedAt;

  if (next !== "blocked") {
    delete candidate.block;
  }
  if (next !== "completed") {
    delete candidate.completedAt;
  }

  return candidate;
}

export function createTask(input: TaskCreateInput): Task {
  return TaskSchema.parse({ ...input, revision: 0 });
}

export function markTaskReady(current: Task, expectedRevision: number, updatedAt: string): Task {
  assertCurrentState(current, ["proposed", "blocked"], "mark ready");
  return TaskSchema.parse(transitionBase(current, "ready", expectedRevision, updatedAt));
}

export function leaseTask(current: Task, expectedRevision: number, updatedAt: string): Task {
  assertCurrentState(current, ["ready"], "lease");
  return TaskSchema.parse(transitionBase(current, "leased", expectedRevision, updatedAt));
}

export function startTask(current: Task, expectedRevision: number, updatedAt: string): Task {
  assertCurrentState(current, ["leased"], "start");
  return TaskSchema.parse(transitionBase(current, "running", expectedRevision, updatedAt));
}

export function returnTaskToReadyAfterRunTermination(
  current: Task,
  expectedRevision: number,
  updatedAt: string,
): Task {
  assertCurrentState(current, ["leased", "running"], "return to ready after run termination");
  const candidate = transitionBase(current, "ready", expectedRevision, updatedAt);
  delete candidate.ownerAgentId;
  return TaskSchema.parse(candidate);
}

export function returnTaskToReadyAfterRunLoss(
  current: Task,
  expectedRevision: number,
  updatedAt: string,
): Task {
  return returnTaskToReadyAfterRunTermination(current, expectedRevision, updatedAt);
}

export function blockTask(
  current: Task,
  reason: TaskBlockReason,
  detail: string,
  expectedRevision: number,
  updatedAt: string,
): Task {
  assertCurrentState(current, ["ready", "leased", "running", "review"], "block");
  const candidate = transitionBase(current, "blocked", expectedRevision, updatedAt);
  candidate.block = { reason, detail, since: updatedAt };
  return TaskSchema.parse(candidate);
}

export function submitTaskForReview(current: Task, expectedRevision: number, updatedAt: string): Task {
  assertCurrentState(current, ["running"], "submit for review");
  return TaskSchema.parse(transitionBase(current, "review", expectedRevision, updatedAt));
}

export function requestTaskRework(current: Task, expectedRevision: number, updatedAt: string): Task {
  assertCurrentState(current, ["review"], "request rework");
  return TaskSchema.parse(transitionBase(current, "ready", expectedRevision, updatedAt));
}

export function completeTaskFromReview(current: Task, expectedRevision: number, updatedAt: string): Task {
  assertCurrentState(current, ["review"], "complete from review");
  const candidate = transitionBase(current, "completed", expectedRevision, updatedAt);
  candidate.completedAt = updatedAt;
  return TaskSchema.parse(candidate);
}

export function failTask(current: Task, expectedRevision: number, updatedAt: string): Task {
  assertCurrentState(current, ["leased", "running", "review"], "fail");
  return TaskSchema.parse(transitionBase(current, "failed", expectedRevision, updatedAt));
}

export function cancelTask(current: Task, expectedRevision: number, updatedAt: string): Task {
  assertCurrentState(
    current,
    ["proposed", "ready", "leased", "running", "blocked", "review"],
    "cancel",
  );
  return TaskSchema.parse(transitionBase(current, "cancelled", expectedRevision, updatedAt));
}

export function rejectProposedTask(current: Task, expectedRevision: number, updatedAt: string): Task {
  assertCurrentState(current, ["proposed"], "reject");
  return TaskSchema.parse(transitionBase(current, "rejected", expectedRevision, updatedAt));
}

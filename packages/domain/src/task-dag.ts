import {
  TaskDependencySchema,
  type OrganizationId,
  type TaskDependency,
  type TaskId,
  type TaskState,
} from "@aop/protocol";

import { invariant } from "./errors.js";

function edgeKey(edge: Pick<TaskDependency, "organizationId" | "taskId" | "dependsOnTaskId">): string {
  return `${edge.organizationId}:${edge.taskId}:${edge.dependsOnTaskId}`;
}

function hasPath(
  edges: readonly TaskDependency[],
  organizationId: OrganizationId,
  from: TaskId,
  target: TaskId,
): boolean {
  const adjacency = new Map<TaskId, TaskId[]>();

  for (const edge of edges) {
    if (edge.organizationId !== organizationId) continue;
    const next = adjacency.get(edge.taskId) ?? [];
    next.push(edge.dependsOnTaskId);
    adjacency.set(edge.taskId, next);
  }

  const stack: TaskId[] = [from];
  const visited = new Set<TaskId>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }

  return false;
}

export function addTaskDependency(
  existing: readonly TaskDependency[],
  candidateInput: TaskDependency,
): readonly TaskDependency[] {
  const candidate = TaskDependencySchema.parse(candidateInput);

  invariant(
    !existing.some((edge) => edgeKey(edge) === edgeKey(candidate)),
    "Task dependency already exists between these tasks",
    { edge: candidate },
  );

  invariant(
    !hasPath(existing, candidate.organizationId, candidate.dependsOnTaskId, candidate.taskId),
    "Task dependency would create a cycle",
    { edge: candidate },
  );

  return [...existing, candidate];
}

export function removeTaskDependency(
  existing: readonly TaskDependency[],
  candidate: TaskDependency,
): readonly TaskDependency[] {
  const key = edgeKey(candidate);
  const filtered = existing.filter((edge) => edgeKey(edge) !== key);
  invariant(filtered.length !== existing.length, "Task dependency does not exist", { edge: candidate });
  return filtered;
}

export function hardBlockingTaskIds(
  organizationId: OrganizationId,
  taskId: TaskId,
  edges: readonly TaskDependency[],
  taskStates: ReadonlyMap<TaskId, TaskState>,
): readonly TaskId[] {
  return edges
    .filter(
      (edge) =>
        edge.organizationId === organizationId && edge.taskId === taskId && edge.type === "hard",
    )
    .map((edge) => edge.dependsOnTaskId)
    .filter((dependencyId) => taskStates.get(dependencyId) !== "completed");
}

export function hasUnresolvedHardDependencies(
  organizationId: OrganizationId,
  taskId: TaskId,
  edges: readonly TaskDependency[],
  taskStates: ReadonlyMap<TaskId, TaskState>,
): boolean {
  return hardBlockingTaskIds(organizationId, taskId, edges, taskStates).length > 0;
}

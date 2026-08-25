import { describe, expect, it } from "vitest";

import type { TaskDependency, TaskId, TaskState } from "@aop/protocol";

import { DomainError } from "./errors.js";
import { addTaskDependency, hardBlockingTaskIds } from "./task-dag.js";

const suffixes = {
  a: "00000000000000000000000000",
  b: "00000000000000000000000001",
  c: "00000000000000000000000002",
} as const;

const org = `org_${suffixes.a}` as const;
const taskA = `tsk_${suffixes.a}` as TaskId;
const taskB = `tsk_${suffixes.b}` as TaskId;
const taskC = `tsk_${suffixes.c}` as TaskId;

const edge = (taskId: TaskId, dependsOnTaskId: TaskId, type: TaskDependency["type"] = "hard"): TaskDependency => ({
  organizationId: org,
  taskId,
  dependsOnTaskId,
  type,
});

describe("Task DAG service", () => {
  it("rejects a dependency edge that closes a cycle", () => {
    const first = addTaskDependency([], edge(taskA, taskB));
    const second = addTaskDependency(first, edge(taskB, taskC));
    expect(() => addTaskDependency(second, edge(taskC, taskA))).toThrow(DomainError);
  });

  it("rejects duplicate endpoints even when dependency type differs", () => {
    const first = addTaskDependency([], edge(taskA, taskB, "hard"));
    expect(() => addTaskDependency(first, edge(taskA, taskB, "soft"))).toThrow(DomainError);
  });

  it("only hard dependencies block readiness", () => {
    const edges = [edge(taskA, taskB, "hard"), edge(taskA, taskC, "informational")];
    const states = new Map<TaskId, TaskState>([
      [taskB, "running"],
      [taskC, "proposed"],
    ]);

    expect(hardBlockingTaskIds(org, taskA, edges, states)).toEqual([taskB]);
  });

  it("considers a completed hard dependency resolved", () => {
    const edges = [edge(taskA, taskB)];
    const states = new Map<TaskId, TaskState>([[taskB, "completed"]]);
    expect(hardBlockingTaskIds(org, taskA, edges, states)).toEqual([]);
  });
});

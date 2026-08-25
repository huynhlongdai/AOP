import { describe, expect, it } from "vitest";

import type { Task } from "@aop/protocol";

import { DomainError } from "./errors.js";
import {
  blockTask,
  completeTaskFromReview,
  leaseTask,
  markTaskReady,
  requestTaskRework,
  startTask,
  submitTaskForReview,
} from "./task-state.js";

const ULID = "00000000000000000000000000";
const t0 = "2026-08-25T12:00:00+07:00";
const t1 = "2026-08-25T12:05:00+07:00";

const proposed: Task = {
  id: `tsk_${ULID}`,
  organizationId: `org_${ULID}`,
  goalId: `gol_${ULID}`,
  title: "Implement authentication API",
  objective: "Provide secure authentication.",
  createdBy: { type: "agent", id: `agt_${ULID}` },
  priority: "high",
  state: "proposed",
  scope: { includes: ["Authentication backend"], excludes: ["Login UI"] },
  inputs: [],
  deliverables: [{ type: "code.backend", description: "Auth implementation", required: true }],
  acceptanceCriteria: ["Tests pass"],
  requiredCapabilities: ["code.backend"],
  constraints: {},
  budget: {},
  revision: 0,
  createdAt: t0,
  updatedAt: t0,
};

describe("Task state machine", () => {
  it("requires lease before execution", () => {
    const ready = markTaskReady(proposed, 0, t1);
    expect(() => startTask(ready, 1, t1)).toThrow(DomainError);

    const leased = leaseTask(ready, 1, t1);
    const running = startTask(leased, 2, t1);
    expect(running.state).toBe("running");
  });

  it("does not allow a running task to complete without review", () => {
    const ready = markTaskReady(proposed, 0, t1);
    const running = startTask(leaseTask(ready, 1, t1), 2, t1);
    expect(() => completeTaskFromReview(running, 3, t1)).toThrow(DomainError);
  });

  it("supports review -> rework -> new execution path", () => {
    const ready = markTaskReady(proposed, 0, t1);
    const running = startTask(leaseTask(ready, 1, t1), 2, t1);
    const review = submitTaskForReview(running, 3, t1);
    const rework = requestTaskRework(review, 4, t1);
    expect(rework.state).toBe("ready");
    expect(rework.revision).toBe(5);
  });

  it("requires structured blocker state", () => {
    const ready = markTaskReady(proposed, 0, t1);
    const blocked = blockTask(ready, "dependency", "API contract is not approved", 1, t1);
    expect(blocked.state).toBe("blocked");
    expect(blocked.block?.reason).toBe("dependency");
  });

  it("completes only from review and records verified completion time", () => {
    const ready = markTaskReady(proposed, 0, t1);
    const running = startTask(leaseTask(ready, 1, t1), 2, t1);
    const review = submitTaskForReview(running, 3, t1);
    const completed = completeTaskFromReview(review, 4, t1);
    expect(completed.state).toBe("completed");
    expect(completed.completedAt).toBe(t1);
  });
});

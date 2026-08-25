import { describe, expect, it } from "vitest";

import { GoalSchema, LeaseSchema, TaskRunSchema, TaskSchema } from "./work.js";

const ULID = "00000000000000000000000000";
const now = "2026-08-25T12:00:00+07:00";
const later = "2026-08-25T12:10:00+07:00";

const taskFixture = {
  id: `tsk_${ULID}`,
  organizationId: `org_${ULID}`,
  goalId: `gol_${ULID}`,
  title: "Implement authentication API",
  objective: "Provide secure authentication for the MVP.",
  createdBy: { type: "agent", id: `agt_${ULID}` },
  priority: "high",
  state: "ready",
  scope: { includes: ["Authentication backend"], excludes: ["Login UI"] },
  inputs: [],
  deliverables: [{ type: "code.backend", description: "Authentication implementation", required: true }],
  acceptanceCriteria: ["Automated authentication tests pass"],
  requiredCapabilities: ["code.backend"],
  constraints: { productionAccess: false },
  budget: { maxToolCalls: 100, maxTokens: 250000 },
  revision: 0,
  createdAt: now,
  updatedAt: now,
} as const;

describe("work protocol schemas", () => {
  it("requires completedAt for completed goals", () => {
    expect(
      GoalSchema.safeParse({
        id: `gol_${ULID}`,
        organizationId: `org_${ULID}`,
        title: "Launch MVP",
        objective: "Release a verified MVP.",
        owner: { type: "agent", id: `agt_${ULID}` },
        successCriteria: ["MVP deployed"],
        priority: "critical",
        status: "completed",
        revision: 3,
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(false);
  });

  it("accepts a ready work contract", () => {
    expect(TaskSchema.parse(taskFixture).state).toBe("ready");
  });

  it("requires a structured reason when blocked", () => {
    expect(TaskSchema.safeParse({ ...taskFixture, state: "blocked" }).success).toBe(false);
    expect(
      TaskSchema.safeParse({
        ...taskFixture,
        state: "blocked",
        block: { reason: "dependency", detail: "Waiting for API gateway rules", since: now },
      }).success,
    ).toBe(true);
  });

  it("keeps task identity separate from run attempts", () => {
    const run = TaskRunSchema.parse({
      id: `run_${ULID}`,
      organizationId: `org_${ULID}`,
      taskId: `tsk_${ULID}`,
      agentId: `agt_${ULID}`,
      attempt: 2,
      status: "running",
      runtimeType: "runtime.openai",
      workspaceId: "workspace/auth-api/attempt-2",
      startedAt: now,
      revision: 1,
    });

    expect(run.attempt).toBe(2);
  });

  it("requires leases to expire after acquisition", () => {
    expect(
      LeaseSchema.safeParse({
        id: `lea_${ULID}`,
        organizationId: `org_${ULID}`,
        taskId: `tsk_${ULID}`,
        runId: `run_${ULID}`,
        agentId: `agt_${ULID}`,
        status: "active",
        attempt: 1,
        acquiredAt: now,
        expiresAt: later,
        heartbeatIntervalSeconds: 60,
        revision: 0,
      }).success,
    ).toBe(true);
  });
});

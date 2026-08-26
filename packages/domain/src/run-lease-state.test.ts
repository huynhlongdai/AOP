import { describe, expect, it } from "vitest";

import type { Lease, TaskRun } from "@aop/protocol";

import { finishTaskRun, prepareTaskRun, releaseLease, startTaskRun } from "./run-lease-state.js";

const ulid = (digit: string) => digit.repeat(26);
const now = "2026-08-25T17:00:00.000Z";

const createdRun: TaskRun = {
  id: `run_${ulid("1")}`,
  organizationId: `org_${ulid("1")}`,
  taskId: `tsk_${ulid("1")}`,
  agentId: `agt_${ulid("1")}`,
  attempt: 1,
  status: "created",
  runtimeType: "runtime.test",
  workspaceId: "workspace-1",
  revision: 0,
};

const activeLease: Lease = {
  id: `lea_${ulid("1")}`,
  organizationId: createdRun.organizationId,
  taskId: createdRun.taskId,
  runId: createdRun.id,
  agentId: createdRun.agentId,
  status: "active",
  attempt: 1,
  acquiredAt: now,
  expiresAt: "2026-08-25T17:10:00.000Z",
  heartbeatIntervalSeconds: 30,
  revision: 0,
};

describe("TaskRun lifecycle", () => {
  it("moves created -> preparing -> running -> succeeded with monotonic revisions", () => {
    const prepared = prepareTaskRun(createdRun, 0, "provider-runtime-1");
    const running = startTaskRun(prepared, 1, now);
    const succeeded = finishTaskRun(running, 2, "2026-08-25T17:01:00.000Z", "succeeded");

    expect(prepared).toMatchObject({ status: "preparing", runtimeId: "provider-runtime-1", revision: 1 });
    expect(running).toMatchObject({ status: "running", startedAt: now, heartbeatAt: now, revision: 2 });
    expect(succeeded).toMatchObject({ status: "succeeded", finishedAt: "2026-08-25T17:01:00.000Z", revision: 3 });
  });

  it("requires a failure reason for failed Runs", () => {
    const running = startTaskRun(prepareTaskRun(createdRun, 0, "provider-runtime-1"), 1, now);
    expect(() => finishTaskRun(running, 2, now, "failed")).toThrow(/failure reason/i);
  });

  it("rejects invalid lifecycle jumps and stale revisions", () => {
    expect(() => startTaskRun(createdRun, 0, now)).toThrow(/preparing/);
    expect(() => prepareTaskRun(createdRun, 1, "provider-runtime-1")).toThrow(/revision/i);
  });

  it("releases an active Lease exactly once", () => {
    const released = releaseLease(activeLease, 0);
    expect(released).toMatchObject({ status: "released", revision: 1 });
    expect(() => releaseLease(released, 1)).toThrow(/non-active/);
  });
});

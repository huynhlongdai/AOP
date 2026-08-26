import { describe, expect, it } from "vitest";

import type { Agent, CommandId, OrganizationId, TaskId, TaskRunId } from "@aop/protocol";
import {
  KernelLifecycleCommandError,
  type ExecuteRuntimeInput,
  type RuntimeExecutionPolicy,
  type RuntimeRunReport,
} from "@aop/runtime";

import {
  DeterministicRuntimeManifestIdSource,
  RuntimeDispatcher,
  type RuntimeCandidateStore,
  type RuntimeDispatchCandidate,
  type RuntimeExecutionPolicyResolver,
} from "./runtime-dispatcher.js";

const ulid = (digit: string) => digit.repeat(26);
const organizationId = `org_${ulid("1")}` as OrganizationId;
const taskId = `tsk_${ulid("2")}` as TaskId;
const runId = `run_${ulid("3")}` as TaskRunId;
const agentId = `agt_${ulid("4")}` as const;
const acquiredAt = "2026-08-26T10:30:00.000+07:00";

const agent: Agent = {
  id: agentId,
  name: "Runtime Worker",
  version: "0.1.0",
  capabilities: ["task.submit_review"],
  runtime: { adapter: "runtime.openai", provider: "openai", modelPolicy: "engineering" },
  revision: 0,
  createdAt: acquiredAt,
  updatedAt: acquiredAt,
};

const candidate: RuntimeDispatchCandidate = {
  organizationId,
  taskId,
  taskRevision: 2,
  runId,
  agent,
  leaseAcquiredAt: acquiredAt,
  heartbeatIntervalSeconds: 30,
  taskBudget: { maxToolCalls: 4 },
};

class Candidates implements RuntimeCandidateStore {
  constructor(readonly values: readonly RuntimeDispatchCandidate[] = [candidate]) {}
  async listCandidates(): Promise<readonly RuntimeDispatchCandidate[]> {
    return this.values;
  }
}

class Policies implements RuntimeExecutionPolicyResolver {
  constructor(readonly value: RuntimeExecutionPolicy) {}
  async resolve(): Promise<RuntimeExecutionPolicy> {
    return this.value;
  }
}

function report(input: ExecuteRuntimeInput): RuntimeRunReport {
  return {
    organizationId: input.organizationId,
    runId: input.runId,
    agentId: input.agent.id,
    contextManifestId: input.manifestId,
    runtimeId: "runtime-test",
    adapter: "runtime.openai",
    provider: "openai",
    model: "gpt-5.5",
    status: "succeeded",
    startedAt: acquiredAt,
    finishedAt: acquiredAt,
    usage: { inputTokens: 10, outputTokens: 5, toolCalls: 0 },
    traceRefs: [],
    commandOutcomes: [],
  };
}

describe("RuntimeDispatcher", () => {
  it("skips provider execution when the Agent lacks the required completion authority", async () => {
    let calls = 0;
    const dispatcher = new RuntimeDispatcher(
      new Candidates(),
      new Policies({ allowedCommandTypes: [], allowedToolCapabilities: [] }),
      {
        execute: async (input) => {
          calls += 1;
          return report(input);
        },
      },
      new DeterministicRuntimeManifestIdSource(),
      { maxConcurrent: 1, maxContextTokens: 16_000 },
    );

    expect(await dispatcher.runOnce()).toEqual([
      {
        status: "skipped",
        organizationId,
        runId,
        reason: "Agent lacks ALLOW authority for required completion command task.submit_review",
      },
    ]);
    expect(calls).toBe(0);
  });

  it("executes with deterministic Context identity and a heartbeat faster than the Lease interval", async () => {
    let received: ExecuteRuntimeInput | undefined;
    const policy: RuntimeExecutionPolicy = {
      allowedCommandTypes: ["task.submit_review"],
      allowedToolCapabilities: [],
      maxOutputTokens: 2_000,
      maxToolCalls: 4,
    };
    const manifestIds = new DeterministicRuntimeManifestIdSource();
    const expectedManifestId = manifestIds.next(candidate);
    const dispatcher = new RuntimeDispatcher(
      new Candidates(),
      new Policies(policy),
      {
        execute: async (input) => {
          received = input;
          return report(input);
        },
      },
      manifestIds,
      { maxConcurrent: 1, maxContextTokens: 24_000 },
    );

    const outcomes = await dispatcher.runOnce();

    expect(received).toMatchObject({
      organizationId,
      runId,
      agent,
      manifestId: expectedManifestId,
      maxContextTokens: 24_000,
      heartbeatIntervalMs: 15_000,
      policy,
    });
    expect(outcomes[0]).toMatchObject({ status: "executed", organizationId, runId });
    if (outcomes[0]?.status === "executed") {
      expect(outcomes[0].report.contextManifestId).toBe(expectedManifestId);
    }
  });

  it("classifies Kernel lifecycle races as contention instead of provider failure", async () => {
    const commandId = `cmd_${ulid("9")}` as CommandId;
    const dispatcher = new RuntimeDispatcher(
      new Candidates(),
      new Policies({ allowedCommandTypes: ["task.submit_review"], allowedToolCapabilities: [] }),
      {
        execute: async () => {
          throw new KernelLifecycleCommandError("task_run.prepare", {
            ok: false,
            commandId,
            error: {
              code: "revision_conflict",
              message: "another worker won the Run",
              retryable: true,
              details: {},
            },
          });
        },
      },
      new DeterministicRuntimeManifestIdSource(),
      { maxConcurrent: 1, maxContextTokens: 16_000 },
    );

    expect(await dispatcher.runOnce()).toEqual([
      {
        status: "contended",
        organizationId,
        runId,
        reason: "Kernel lifecycle task_run.prepare failed: revision_conflict: another worker won the Run",
      },
    ]);
  });
});

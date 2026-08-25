import { describe, expect, it } from "vitest";

import type { Agent, CommandResult, ContextManifest } from "@aop/protocol";

import {
  RuntimeManager,
  type ContextManifestProvider,
  type KernelCommandSubmission,
  type KernelRuntimePort,
  type PreparedRuntime,
  type RuntimeAdapter,
  type RuntimeExecutionResult,
  type RuntimeInspection,
} from "./runtime-manager.js";

const ulid = (digit: string) => digit.repeat(26);
const orgId = `org_${ulid("1")}` as const;
const agentId = `agt_${ulid("2")}` as const;
const taskId = `tsk_${ulid("3")}` as const;
const runId = `run_${ulid("4")}` as const;
const manifestId = `ctx_${ulid("5")}` as const;
const commandId = `cmd_${ulid("6")}` as const;
const now = "2026-08-25T16:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}` as const;

const agent: Agent = {
  id: agentId,
  name: "CTO Agent",
  version: "0.1.0",
  description: "Engineering planner",
  capabilities: ["task.create"],
  runtime: { adapter: "runtime.test", provider: "test", modelPolicy: "bounded" },
  revision: 1,
  createdAt: now,
  updatedAt: now,
};

const mandatoryKinds = ["policy", "identity", "role", "authority", "goal", "task", "output_contract"] as const;
const fragments = mandatoryKinds.map((kind, index) => ({
  key: `${kind}:${index}`,
  kind,
  trust: "authoritative" as const,
  mandatory: true,
  authorityWeight: 1,
  relevanceWeight: 1,
  tokenEstimate: 1,
  content: JSON.stringify({ kind }),
  digest,
}));

const manifest: ContextManifest = {
  schemaVersion: 1,
  protocolVersion: "0.1.0",
  id: manifestId,
  organizationId: orgId,
  taskId,
  runId,
  agentId,
  taskRevision: 3,
  fragments,
  totalTokenEstimate: fragments.length,
  compiledAt: now,
};

class FakeContext implements ContextManifestProvider {
  readonly value: ContextManifest;
  calls = 0;

  constructor(value: ContextManifest = manifest) {
    this.value = value;
  }

  async getOrCompile(): Promise<ContextManifest> {
    this.calls += 1;
    return this.value;
  }
}

class FakeKernel implements KernelRuntimePort {
  prepared: unknown[] = [];
  running: unknown[] = [];
  heartbeats: unknown[] = [];
  finished: Array<Record<string, unknown>> = [];
  submissions: KernelCommandSubmission[] = [];

  async recordPrepared(input: Parameters<KernelRuntimePort["recordPrepared"]>[0]): Promise<void> {
    this.prepared.push(input);
  }

  async recordRunning(input: Parameters<KernelRuntimePort["recordRunning"]>[0]): Promise<void> {
    this.running.push(input);
  }

  async heartbeat(input: Parameters<KernelRuntimePort["heartbeat"]>[0]): Promise<void> {
    this.heartbeats.push(input);
  }

  async recordFinished(input: Parameters<KernelRuntimePort["recordFinished"]>[0]): Promise<void> {
    this.finished.push(input as unknown as Record<string, unknown>);
  }

  async submitAgentCommand(input: KernelCommandSubmission): Promise<CommandResult> {
    this.submissions.push(input);
    return { ok: true, commandId, resultingRevision: 4, emittedEventIds: [] };
  }
}

class FakeAdapter implements RuntimeAdapter {
  readonly name = "runtime.test";
  readonly prepared: PreparedRuntime = {
    runtimeId: "runtime-1",
    adapter: "runtime.test",
    provider: "test",
    model: "model-1",
    traceRefs: [{ provider: "test", traceId: "prepare-trace" }],
  };
  prepareInputs: unknown[] = [];
  cancelled: Array<{ runtimeId: string; reason?: string }> = [];
  result: RuntimeExecutionResult = {
    status: "succeeded",
    commandProposals: [],
    usage: { inputTokens: 10, outputTokens: 5, toolCalls: 0 },
    traceRefs: [{ provider: "test", traceId: "run-trace" }],
  };
  startError: Error | undefined;

  async prepare(input: Parameters<RuntimeAdapter["prepare"]>[0]): Promise<PreparedRuntime> {
    this.prepareInputs.push(input);
    return this.prepared;
  }

  async start(): Promise<RuntimeExecutionResult> {
    if (this.startError !== undefined) throw this.startError;
    return this.result;
  }

  async cancel(runtimeId: string, reason?: string): Promise<void> {
    this.cancelled.push({ runtimeId, ...(reason === undefined ? {} : { reason }) });
  }

  async inspect(): Promise<RuntimeInspection> {
    return { status: "running", traceRefs: [] };
  }
}

const executeInput = {
  organizationId: orgId,
  runId,
  agent,
  manifestId,
  maxContextTokens: 2_000,
  policy: {
    allowedCommandTypes: ["task.create"],
    allowedToolCapabilities: ["filesystem.read"],
    maxOutputTokens: 100,
    maxToolCalls: 4,
  },
} as const;

describe("Runtime Manager intelligence boundary", () => {
  it("passes the exact Manifest to the adapter and binds command identity before Kernel submission", async () => {
    const context = new FakeContext();
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();
    adapter.result = {
      status: "succeeded",
      commandProposals: [
        { type: "task.create", payload: { title: "Backend" } },
        { type: "permission.grant", payload: { capability: "admin" } },
      ],
      output: { plan: "split work" },
      usage: { inputTokens: 100, outputTokens: 20, toolCalls: 1 },
      traceRefs: [{ provider: "test", traceId: "run-trace" }],
    };

    const report = await new RuntimeManager(context, kernel, adapter, () => now).execute(executeInput);

    const prepareInput = adapter.prepareInputs[0] as Parameters<RuntimeAdapter["prepare"]>[0] | undefined;
    expect(prepareInput?.context).toEqual(manifest);
    expect(kernel.submissions).toHaveLength(1);
    expect(kernel.submissions[0]).toEqual({
      organizationId: orgId,
      runId,
      agentId,
      proposal: { type: "task.create", payload: { title: "Backend" } },
    });
    expect(report.commandOutcomes).toHaveLength(2);
    expect(report.commandOutcomes[0]?.forwarded).toBe(true);
    expect(report.commandOutcomes[1]).toMatchObject({
      forwarded: false,
      denialReason: "command_not_allowed_by_execution_policy",
    });
    expect(report.status).toBe("succeeded");
  });

  it("rejects mismatched Context identity before a provider runtime is prepared", async () => {
    const wrongManifest = { ...manifest, runId: `run_${ulid("7")}` as const };
    const context = new FakeContext(wrongManifest);
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();

    await expect(new RuntimeManager(context, kernel, adapter).execute(executeInput)).rejects.toThrow(/identity/);
    expect(adapter.prepareInputs).toHaveLength(0);
    expect(kernel.prepared).toHaveLength(0);
  });

  it("normalizes adapter exceptions into a failed Run report", async () => {
    const context = new FakeContext();
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();
    adapter.startError = new Error("provider timeout");

    const report = await new RuntimeManager(context, kernel, adapter, () => now).execute(executeInput);

    expect(report.status).toBe("failed");
    expect(report.failureReason).toBe("provider timeout");
    expect(report.commandOutcomes).toEqual([]);
    expect(kernel.finished[0]).toMatchObject({ status: "failed", failureReason: "provider timeout" });
  });

  it("fails closed when provider-reported usage exceeds the execution policy", async () => {
    const context = new FakeContext();
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();
    adapter.result = {
      status: "succeeded",
      commandProposals: [{ type: "task.create", payload: { title: "Should not forward" } }],
      usage: { inputTokens: 10, outputTokens: 101, toolCalls: 0 },
      traceRefs: [],
    };

    const report = await new RuntimeManager(context, kernel, adapter, () => now).execute(executeInput);

    expect(report.status).toBe("failed");
    expect(report.failureReason).toMatch(/maxOutputTokens/);
    expect(kernel.submissions).toHaveLength(0);
  });

  it("routes heartbeat and cancellation through trusted control-plane ports", async () => {
    const context = new FakeContext();
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();
    const manager = new RuntimeManager(context, kernel, adapter);

    await manager.heartbeat({ organizationId: orgId, runId, agentId, runtimeId: "runtime-1" });
    await manager.cancel({ organizationId: orgId, runId, agentId, runtimeId: "runtime-1", reason: "operator stop" });

    expect(kernel.heartbeats).toHaveLength(1);
    expect(adapter.cancelled).toEqual([{ runtimeId: "runtime-1", reason: "operator stop" }]);
    expect(kernel.finished[0]).toMatchObject({ status: "cancelled", failureReason: "operator stop" });
  });
});

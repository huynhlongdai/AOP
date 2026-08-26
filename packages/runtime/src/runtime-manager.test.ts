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
  error: Error | undefined;
  timeline?: string[];

  constructor(value: ContextManifest = manifest, timeline?: string[]) {
    this.value = value;
    this.timeline = timeline;
  }

  async getOrCompile(): Promise<ContextManifest> {
    this.calls += 1;
    this.timeline?.push("context.compile");
    if (this.error !== undefined) throw this.error;
    return this.value;
  }
}

class FakeKernel implements KernelRuntimePort {
  prepared: unknown[] = [];
  running: unknown[] = [];
  heartbeats: unknown[] = [];
  finished: Array<Record<string, unknown>> = [];
  submissions: KernelCommandSubmission[] = [];
  preparedError: Error | undefined;
  submissionErrorAtIndex: number | undefined;
  timeline?: string[];

  constructor(timeline?: string[]) {
    this.timeline = timeline;
  }

  async recordPrepared(input: Parameters<KernelRuntimePort["recordPrepared"]>[0]): Promise<void> {
    if (this.preparedError !== undefined) throw this.preparedError;
    this.timeline?.push("kernel.prepared");
    this.prepared.push(input);
  }

  async recordRunning(input: Parameters<KernelRuntimePort["recordRunning"]>[0]): Promise<void> {
    this.timeline?.push("kernel.running");
    this.running.push(input);
  }

  async heartbeat(input: Parameters<KernelRuntimePort["heartbeat"]>[0]): Promise<void> {
    this.heartbeats.push(input);
  }

  async recordFinished(input: Parameters<KernelRuntimePort["recordFinished"]>[0]): Promise<void> {
    this.timeline?.push("kernel.finished");
    this.finished.push(input as unknown as Record<string, unknown>);
  }

  async submitAgentCommand(input: KernelCommandSubmission): Promise<CommandResult> {
    this.submissions.push(input);
    if (input.proposalIndex === this.submissionErrorAtIndex) throw new Error("gateway unavailable");
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
  startInputs: unknown[] = [];
  startCalls = 0;
  cancelled: Array<{ runtimeId: string; reason?: string }> = [];
  result: RuntimeExecutionResult = {
    status: "succeeded",
    commandProposals: [],
    usage: { inputTokens: 10, outputTokens: 5, toolCalls: 0 },
    traceRefs: [{ provider: "test", traceId: "run-trace" }],
  };
  startError: Error | undefined;
  timeline?: string[];

  constructor(timeline?: string[]) {
    this.timeline = timeline;
  }

  async prepare(input: Parameters<RuntimeAdapter["prepare"]>[0]): Promise<PreparedRuntime> {
    this.timeline?.push("adapter.prepare");
    this.prepareInputs.push(input);
    return this.prepared;
  }

  async start(input: Parameters<RuntimeAdapter["start"]>[0]): Promise<RuntimeExecutionResult> {
    this.timeline?.push("adapter.start");
    this.startInputs.push(input);
    this.startCalls += 1;
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
  it("starts Kernel execution before compiling Context and passes exact Manifest only to reasoning", async () => {
    const timeline: string[] = [];
    const context = new FakeContext(manifest, timeline);
    const kernel = new FakeKernel(timeline);
    const adapter = new FakeAdapter(timeline);
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

    expect(timeline.slice(0, 5)).toEqual([
      "adapter.prepare",
      "kernel.prepared",
      "kernel.running",
      "context.compile",
      "adapter.start",
    ]);
    const prepareInput = adapter.prepareInputs[0] as Record<string, unknown> | undefined;
    expect(prepareInput).toBeDefined();
    expect(prepareInput).not.toHaveProperty("context");
    const startInput = adapter.startInputs[0] as Parameters<RuntimeAdapter["start"]>[0] | undefined;
    expect(startInput?.context).toEqual(manifest);
    expect(kernel.submissions).toHaveLength(1);
    expect(kernel.submissions[0]).toEqual({
      organizationId: orgId,
      runId,
      agentId,
      proposalIndex: 0,
      proposal: { type: "task.create", payload: { title: "Backend" } },
    });
    expect(report.contextManifestId).toBe(manifestId);
    expect(report.commandOutcomes).toHaveLength(2);
    expect(report.commandOutcomes[0]?.forwarded).toBe(true);
    expect(report.commandOutcomes[1]).toMatchObject({
      forwarded: false,
      denialReason: "command_not_allowed_by_execution_policy",
    });
    expect(report.status).toBe("succeeded");
  });

  it("fails and records a pre-reasoning Run when Context identity is mismatched", async () => {
    const wrongManifest = { ...manifest, runId: `run_${ulid("7")}` as const };
    const context = new FakeContext(wrongManifest);
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();

    const report = await new RuntimeManager(context, kernel, adapter, () => now).execute(executeInput);

    expect(adapter.prepareInputs).toHaveLength(1);
    expect(kernel.prepared).toHaveLength(1);
    expect(kernel.running).toHaveLength(1);
    expect(adapter.startCalls).toBe(0);
    expect(adapter.cancelled).toEqual([{ runtimeId: "runtime-1", reason: "context_compile_failed" }]);
    expect(report.status).toBe("failed");
    expect(report.contextManifestId).toBeUndefined();
    expect(report.failureReason).toMatch(/Context compilation failed.*identity/);
    expect(kernel.finished[0]).toMatchObject({
      status: "failed",
      failureReason: expect.stringMatching(/Context compilation failed.*identity/),
    });
    expect(kernel.finished[0]).not.toHaveProperty("contextManifestId");
  });

  it("normalizes Context provider failures into an immutable pre-reasoning failure", async () => {
    const context = new FakeContext();
    context.error = new Error("context store unavailable");
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();

    const report = await new RuntimeManager(context, kernel, adapter, () => now).execute(executeInput);

    expect(report.status).toBe("failed");
    expect(report.contextManifestId).toBeUndefined();
    expect(report.failureReason).toBe("Context compilation failed: context store unavailable");
    expect(adapter.startCalls).toBe(0);
    expect(kernel.finished[0]).not.toHaveProperty("contextManifestId");
  });

  it("normalizes adapter exceptions into a failed Run report with Context evidence", async () => {
    const context = new FakeContext();
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();
    adapter.startError = new Error("provider timeout");

    const report = await new RuntimeManager(context, kernel, adapter, () => now).execute(executeInput);

    expect(report.status).toBe("failed");
    expect(report.contextManifestId).toBe(manifestId);
    expect(report.failureReason).toBe("provider timeout");
    expect(report.commandOutcomes).toEqual([]);
    expect(kernel.finished[0]).toMatchObject({
      status: "failed",
      contextManifestId: manifestId,
      failureReason: "provider timeout",
    });
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

  it("fails the Run and stops forwarding later proposals when Kernel submission throws", async () => {
    const context = new FakeContext();
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();
    kernel.submissionErrorAtIndex = 0;
    adapter.result = {
      status: "succeeded",
      commandProposals: [
        { type: "task.create", payload: { title: "First" } },
        { type: "task.create", payload: { title: "Second" } },
      ],
      usage: { inputTokens: 20, outputTokens: 10, toolCalls: 0 },
      traceRefs: [],
    };

    const report = await new RuntimeManager(context, kernel, adapter, () => now).execute(executeInput);

    expect(kernel.submissions).toHaveLength(1);
    expect(report.status).toBe("failed");
    expect(report.failureReason).toMatch(/gateway unavailable/);
    expect(report.commandOutcomes).toHaveLength(1);
    expect(report.commandOutcomes[0]).toMatchObject({
      forwarded: true,
      denialReason: "kernel_submission_failed:gateway unavailable",
    });
    expect(kernel.finished[0]).toMatchObject({ status: "failed", contextManifestId: manifestId });
  });

  it("cancels a prepared provider runtime when trusted lifecycle persistence fails", async () => {
    const context = new FakeContext();
    const kernel = new FakeKernel();
    const adapter = new FakeAdapter();
    kernel.preparedError = new Error("control plane unavailable");

    await expect(new RuntimeManager(context, kernel, adapter).execute(executeInput)).rejects.toThrow(
      "control plane unavailable",
    );

    expect(context.calls).toBe(0);
    expect(adapter.startCalls).toBe(0);
    expect(adapter.cancelled).toEqual([{ runtimeId: "runtime-1", reason: "kernel_lifecycle_record_failed" }]);
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

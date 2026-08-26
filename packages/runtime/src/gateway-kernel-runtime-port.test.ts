import { describe, expect, it } from "vitest";

import {
  CommandEnvelopeSchema,
  type CommandEnvelope,
  type CommandId,
  type CommandResult,
} from "@aop/protocol";

import {
  GatewayKernelRuntimePort,
  KernelLifecycleCommandError,
  type RuntimeExecutionControlState,
  type RuntimeExecutionStateReader,
} from "./gateway-kernel-runtime-port.js";
import type { RuntimeCommandOutcome } from "./runtime-manager.js";

const ulid = (digit: string) => digit.repeat(26);
const orgId = `org_${ulid("1")}` as const;
const taskId = `tsk_${ulid("2")}` as const;
const runId = `run_${ulid("3")}` as const;
const agentId = `agt_${ulid("4")}` as const;
const leaseId = `lea_${ulid("5")}` as const;
const contextManifestId = `ctx_${ulid("6")}` as const;
const now = "2026-08-26T08:30:00.000+07:00";

function state(overrides: Partial<RuntimeExecutionControlState> = {}): RuntimeExecutionControlState {
  return {
    organizationId: orgId,
    runId,
    taskId,
    agentId,
    runStatus: "created",
    runRevision: 0,
    runtimeType: "runtime.test",
    taskState: "leased",
    taskRevision: 1,
    leaseId,
    leaseStatus: "active",
    leaseRevision: 0,
    heartbeatIntervalSeconds: 20,
    contextManifestId,
    ...overrides,
  };
}

class FakeStateReader implements RuntimeExecutionStateReader {
  value: RuntimeExecutionControlState | undefined;

  constructor(value: RuntimeExecutionControlState | undefined = state()) {
    this.value = value;
  }

  async getRuntimeExecutionState(): Promise<RuntimeExecutionControlState | undefined> {
    return this.value;
  }
}

class FakeGateway {
  envelopes: CommandEnvelope[] = [];
  nextResult: CommandResult | undefined;

  async execute(input: unknown): Promise<CommandResult> {
    const envelope = CommandEnvelopeSchema.parse(input);
    this.envelopes.push(envelope);
    if (this.nextResult !== undefined) return this.nextResult;
    return { ok: true, commandId: envelope.commandId, resultingRevision: 1, emittedEventIds: [] };
  }
}

function ids() {
  let next = 10;
  return {
    nextCommandId: () => `cmd_${String(++next).padStart(26, "0")}` as CommandId,
  };
}

describe("GatewayKernelRuntimePort", () => {
  it("binds Runtime preparation to current Run revision and system authority without Context", async () => {
    const gateway = new FakeGateway();
    const reader = new FakeStateReader();
    const port = new GatewayKernelRuntimePort(gateway, reader, ids(), () => now);

    await port.recordPrepared({
      organizationId: orgId,
      runId,
      agentId,
      runtimeId: "provider-runtime-1",
      adapter: "runtime.test",
      provider: "test-provider",
      model: "test-model",
      traceRefs: [{ provider: "test-provider", traceId: "prepare-trace" }],
    });

    expect(gateway.envelopes).toHaveLength(1);
    expect(gateway.envelopes[0]).toMatchObject({
      type: "task_run.prepare",
      organizationId: orgId,
      actor: { type: "system", id: "runtime-manager" },
      target: { type: "task_run", id: runId },
      expectedRevision: 0,
      idempotencyKey: `runtime:${runId}:prepare`,
      payload: {
        runtimeId: "provider-runtime-1",
        adapter: "runtime.test",
        provider: "test-provider",
        model: "test-model",
      },
    });
    expect(gateway.envelopes[0]?.payload).not.toHaveProperty("contextManifestId");
  });

  it("uses fresh Run and Task revisions when starting", async () => {
    const gateway = new FakeGateway();
    const reader = new FakeStateReader(
      state({
        runStatus: "preparing",
        runRevision: 4,
        runtimeId: "provider-runtime-1",
        taskRevision: 7,
      }),
    );
    const port = new GatewayKernelRuntimePort(gateway, reader, ids(), () => now);

    await port.recordRunning({ organizationId: orgId, runId, agentId, runtimeId: "provider-runtime-1" });

    expect(gateway.envelopes[0]).toMatchObject({
      type: "task_run.start",
      expectedRevision: 4,
      idempotencyKey: `runtime:${runId}:start`,
      payload: { taskExpectedRevision: 7 },
    });
  });

  it("fences heartbeats by the current Lease revision", async () => {
    const gateway = new FakeGateway();
    const reader = new FakeStateReader(
      state({
        runStatus: "running",
        runRevision: 5,
        runtimeId: "provider-runtime-1",
        taskState: "running",
        taskRevision: 8,
        leaseRevision: 3,
        heartbeatIntervalSeconds: 20,
      }),
    );
    const port = new GatewayKernelRuntimePort(gateway, reader, ids(), () => now);

    await port.heartbeat({ organizationId: orgId, runId, agentId, runtimeId: "provider-runtime-1" });

    expect(gateway.envelopes[0]).toMatchObject({
      type: "lease.heartbeat",
      target: { type: "lease", id: leaseId },
      expectedRevision: 3,
      idempotencyKey: `runtime:${runId}:heartbeat:3`,
      payload: { extendSeconds: 40 },
    });
  });

  it("maps bounded command evidence into authoritative task_run.finish", async () => {
    const gateway = new FakeGateway();
    const reader = new FakeStateReader(
      state({
        runStatus: "running",
        runRevision: 9,
        runtimeId: "provider-runtime-1",
        taskState: "review",
        taskRevision: 11,
        leaseRevision: 2,
      }),
    );
    const port = new GatewayKernelRuntimePort(gateway, reader, ids(), () => now);
    const acceptedCommandId = `cmd_${ulid("7")}` as CommandId;
    const rejectedCommandId = `cmd_${ulid("8")}` as CommandId;
    const outcomes: RuntimeCommandOutcome[] = [
      {
        proposalIndex: 0,
        proposal: { type: "artifact.create", target: { type: "task", id: taskId }, payload: { title: "API" } },
        forwarded: true,
        result: { ok: true, commandId: acceptedCommandId, resultingRevision: 3, emittedEventIds: [] },
      },
      {
        proposalIndex: 1,
        proposal: { type: "permission.grant", payload: { capability: "admin" } },
        forwarded: false,
        denialReason: "command_not_allowed_by_execution_policy",
      },
      {
        proposalIndex: 2,
        proposal: { type: "task.create", payload: { title: "Denied" } },
        forwarded: true,
        result: {
          ok: false,
          commandId: rejectedCommandId,
          error: { code: "forbidden", message: "policy denied", retryable: false, details: {} },
        },
      },
    ];

    await port.recordFinished({
      organizationId: orgId,
      runId,
      agentId,
      runtimeId: "provider-runtime-1",
      contextManifestId,
      adapter: "runtime.test",
      provider: "test-provider",
      model: "test-model",
      status: "succeeded",
      usage: { inputTokens: 120, outputTokens: 30, toolCalls: 2, costCredits: 0.5 },
      traceRefs: [{ provider: "test-provider", traceId: "run-trace" }],
      commandOutcomes: outcomes,
    });

    expect(gateway.envelopes[0]).toMatchObject({
      type: "task_run.finish",
      expectedRevision: 9,
      idempotencyKey: `runtime:${runId}:finish`,
      payload: {
        taskExpectedRevision: 11,
        contextManifestId,
        runtimeId: "provider-runtime-1",
        adapter: "runtime.test",
        provider: "test-provider",
        model: "test-model",
        status: "succeeded",
        commandOutcomes: [
          { proposalIndex: 0, commandType: "artifact.create", status: "accepted", commandId: acceptedCommandId },
          {
            proposalIndex: 1,
            commandType: "permission.grant",
            status: "not_forwarded",
            reason: "command_not_allowed_by_execution_policy",
          },
          {
            proposalIndex: 2,
            commandType: "task.create",
            status: "rejected",
            commandId: rejectedCommandId,
            errorCode: "forbidden",
            reason: "policy denied",
          },
        ],
      },
    });
  });

  it("allows failed pre-reasoning finish without inventing Context evidence", async () => {
    const gateway = new FakeGateway();
    const reader = new FakeStateReader(
      state({
        runStatus: "running",
        runRevision: 2,
        runtimeId: "provider-runtime-1",
        taskState: "running",
        taskRevision: 2,
        contextManifestId: undefined,
      }),
    );
    const port = new GatewayKernelRuntimePort(gateway, reader, ids(), () => now);

    await port.recordFinished({
      organizationId: orgId,
      runId,
      agentId,
      runtimeId: "provider-runtime-1",
      adapter: "runtime.test",
      status: "failed",
      usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0 },
      traceRefs: [],
      commandOutcomes: [],
      failureReason: "Context compilation failed: unavailable",
    });

    expect(gateway.envelopes[0]).toMatchObject({
      type: "task_run.finish",
      payload: {
        status: "failed",
        failureReason: "Context compilation failed: unavailable",
      },
    });
    expect(gateway.envelopes[0]?.payload).not.toHaveProperty("contextManifestId");
  });

  it("rejects a successful finish when no exact Context exists", async () => {
    const port = new GatewayKernelRuntimePort(
      new FakeGateway(),
      new FakeStateReader(
        state({
          runStatus: "running",
          runRevision: 2,
          runtimeId: "provider-runtime-1",
          taskState: "review",
          taskRevision: 3,
          contextManifestId: undefined,
        }),
      ),
      ids(),
      () => now,
    );

    await expect(
      port.recordFinished({
        organizationId: orgId,
        runId,
        agentId,
        runtimeId: "provider-runtime-1",
        adapter: "runtime.test",
        status: "succeeded",
        usage: { inputTokens: 1, outputTokens: 1, toolCalls: 0 },
        traceRefs: [],
        commandOutcomes: [],
      }),
    ).rejects.toThrow(/requires authoritative Context Manifest/);
  });

  it("fails closed when Kernel rejects a lifecycle command", async () => {
    const gateway = new FakeGateway();
    const reader = new FakeStateReader();
    gateway.nextResult = {
      ok: false,
      commandId: `cmd_${ulid("9")}` as CommandId,
      error: { code: "forbidden", message: "runtime-manager permission missing", retryable: false, details: {} },
    };
    const port = new GatewayKernelRuntimePort(gateway, reader, ids(), () => now);

    await expect(
      port.recordPrepared({
        organizationId: orgId,
        runId,
        agentId,
        runtimeId: "provider-runtime-1",
        adapter: "runtime.test",
        traceRefs: [],
      }),
    ).rejects.toBeInstanceOf(KernelLifecycleCommandError);
  });
});

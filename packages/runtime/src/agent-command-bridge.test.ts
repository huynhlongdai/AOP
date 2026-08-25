import { describe, expect, it } from "vitest";

import type { CommandId, CommandResult } from "@aop/protocol";

import { GatewayAgentCommandBridge, type CommandGatewayLike } from "./agent-command-bridge.js";
import type { KernelCommandSubmission } from "./runtime-manager.js";

const ulid = (digit: string) => digit.repeat(26);
const orgId = `org_${ulid("1")}` as const;
const agentId = `agt_${ulid("2")}` as const;
const runId = `run_${ulid("3")}` as const;
const taskId = `tsk_${ulid("4")}` as const;
const commandIds = [`cmd_${ulid("5")}`, `cmd_${ulid("6")}`] as const;
const issuedAt = "2026-08-25T16:30:00.000Z";

class CapturingGateway implements CommandGatewayLike {
  inputs: unknown[] = [];

  async execute(input: unknown): Promise<CommandResult> {
    this.inputs.push(input);
    const command = input as { commandId: CommandId };
    return { ok: true, commandId: command.commandId, emittedEventIds: [] };
  }
}

class SequenceIds {
  index = 0;

  nextCommandId(): CommandId {
    const value = commandIds[this.index];
    if (value === undefined) throw new Error("Command ID fixture exhausted");
    this.index += 1;
    return value;
  }
}

const submission: KernelCommandSubmission = {
  organizationId: orgId,
  runId,
  agentId,
  proposalIndex: 0,
  proposal: {
    type: "task.submit_review",
    target: { type: "task", id: taskId },
    expectedRevision: 7,
    payload: { reviewId: `rev_${ulid("7")}`, criteria: [{ key: "qa.pass", description: "Pass", required: true }] },
  },
};

describe("Gateway Agent Command Bridge", () => {
  it("binds organization, actor, protocol metadata and deterministic idempotency outside runtime output", async () => {
    const gateway = new CapturingGateway();
    const bridge = new GatewayAgentCommandBridge(gateway, new SequenceIds(), () => issuedAt);

    await bridge.submit(submission);

    expect(gateway.inputs[0]).toEqual({
      schemaVersion: 1,
      protocolVersion: "0.1.0",
      commandId: commandIds[0],
      type: "task.submit_review",
      organizationId: orgId,
      actor: { type: "agent", id: agentId },
      target: { type: "task", id: taskId },
      expectedRevision: 7,
      idempotencyKey: `runtime:${runId}:proposal:0`,
      payload: submission.proposal.payload,
      issuedAt,
    });
  });

  it("uses the same idempotency identity for a replay even when the trusted command ID changes", async () => {
    const gateway = new CapturingGateway();
    const bridge = new GatewayAgentCommandBridge(gateway, new SequenceIds(), () => issuedAt);

    await bridge.submit(submission);
    await bridge.submit(submission);

    const first = gateway.inputs[0] as { commandId: string; idempotencyKey: string };
    const second = gateway.inputs[1] as { commandId: string; idempotencyKey: string };
    expect(first.commandId).not.toBe(second.commandId);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });

  it("separates distinct proposal positions from the same Run", async () => {
    const gateway = new CapturingGateway();
    const bridge = new GatewayAgentCommandBridge(gateway, new SequenceIds(), () => issuedAt);

    await bridge.submit(submission);
    await bridge.submit({ ...submission, proposalIndex: 1 });

    const first = gateway.inputs[0] as { idempotencyKey: string };
    const second = gateway.inputs[1] as { idempotencyKey: string };
    expect(first.idempotencyKey).toBe(`runtime:${runId}:proposal:0`);
    expect(second.idempotencyKey).toBe(`runtime:${runId}:proposal:1`);
  });

  it("rejects invalid trusted proposal indices before invoking the Command Gateway", async () => {
    const gateway = new CapturingGateway();
    const bridge = new GatewayAgentCommandBridge(gateway, new SequenceIds(), () => issuedAt);

    await expect(bridge.submit({ ...submission, proposalIndex: -1 })).rejects.toThrow(/proposalIndex/);
    expect(gateway.inputs).toHaveLength(0);
  });
});

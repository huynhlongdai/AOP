import { describe, expect, it } from "vitest";

import {
  CommandEnvelopeSchema,
  ContextManifestSchema,
  EventEnvelopeSchema,
  ProtocolErrorSchema,
} from "./envelopes.js";

const ULID = "00000000000000000000000000";
const now = "2026-08-25T12:00:00+07:00";
const digest = `sha256:${"0".repeat(64)}`;

describe("command/event/context envelopes", () => {
  it("requires actor, org scope, revision and idempotency metadata on commands", () => {
    const command = CommandEnvelopeSchema.parse({
      schemaVersion: 1,
      protocolVersion: "0.1.0",
      commandId: `cmd_${ULID}`,
      type: "task.start",
      organizationId: `org_${ULID}`,
      actor: { type: "agent", id: `agt_${ULID}` },
      target: { type: "task", id: `tsk_${ULID}` },
      expectedRevision: 7,
      idempotencyKey: "task-1402-start-attempt-2",
      payload: {},
      issuedAt: now,
    });

    expect(command.expectedRevision).toBe(7);
  });

  it("models ordered events as committed facts", () => {
    const event = EventEnvelopeSchema.parse({
      schemaVersion: 1,
      protocolVersion: "0.1.0",
      eventId: `evt_${ULID}`,
      type: "task.started",
      organizationId: `org_${ULID}`,
      organizationSequence: 42,
      aggregate: { type: "task", id: `tsk_${ULID}` },
      aggregateRevision: 8,
      actor: { type: "agent", id: `agt_${ULID}` },
      causationId: `cmd_${ULID}`,
      correlationId: "goal-launch-mvp",
      payload: {},
      occurredAt: now,
    });

    expect(event.organizationSequence).toBe(42);
  });

  it("requires approval ID on approval_required errors", () => {
    expect(
      ProtocolErrorSchema.safeParse({
        code: "approval_required",
        message: "Human approval required",
        retryable: false,
        details: {},
      }).success,
    ).toBe(false);
  });

  it("requires exact mandatory organizational context classes", () => {
    const base = {
      schemaVersion: 1,
      protocolVersion: "0.1.0",
      id: `ctx_${ULID}`,
      organizationId: `org_${ULID}`,
      taskId: `tsk_${ULID}`,
      runId: `run_${ULID}`,
      agentId: `agt_${ULID}`,
      taskRevision: 12,
      compiledAt: now,
    } as const;

    const fragment = (kind: string) => ({
      key: kind,
      kind,
      trust: "authoritative",
      mandatory: true,
      authorityWeight: 1,
      relevanceWeight: 1,
      tokenEstimate: 10,
      content: `{"kind":"${kind}"}`,
      digest,
    });

    const fragments = [
      fragment("policy"),
      fragment("identity"),
      fragment("role"),
      fragment("authority"),
      fragment("goal"),
      fragment("task"),
      fragment("output_contract"),
    ];

    expect(ContextManifestSchema.safeParse({ ...base, fragments, totalTokenEstimate: 70 }).success).toBe(true);
    expect(ContextManifestSchema.safeParse({ ...base, fragments: fragments.slice(1), totalTokenEstimate: 60 }).success).toBe(false);
  });

  it("forbids untrusted context from carrying authority weight", () => {
    const fragment = {
      key: "external:web",
      kind: "external_evidence",
      trust: "untrusted",
      mandatory: false,
      authorityWeight: 0.2,
      relevanceWeight: 1,
      tokenEstimate: 10,
      content: "external text",
      digest,
    };

    expect(
      ContextManifestSchema.safeParse({
        schemaVersion: 1,
        protocolVersion: "0.1.0",
        id: `ctx_${ULID}`,
        organizationId: `org_${ULID}`,
        taskId: `tsk_${ULID}`,
        runId: `run_${ULID}`,
        agentId: `agt_${ULID}`,
        taskRevision: 1,
        fragments: [fragment],
        totalTokenEstimate: 10,
        compiledAt: now,
      }).success,
    ).toBe(false);
  });
});

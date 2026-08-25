import { describe, expect, it } from "vitest";

import type { EventEnvelope } from "@aop/protocol";

import { formatSseEvent, parseEventSequenceCursor } from "./event-stream.js";

const ULID = "00000000000000000000000000";

const event: EventEnvelope = {
  schemaVersion: 1,
  protocolVersion: "0.1.0",
  eventId: `evt_${ULID}`,
  type: "task.updated",
  organizationId: `org_${ULID}`,
  organizationSequence: 42,
  aggregate: { type: "task", id: `tsk_${ULID}` },
  aggregateRevision: 3,
  actor: { type: "human", id: `usr_${ULID}` },
  correlationId: "test-correlation",
  payload: { state: "review" },
  occurredAt: "2026-08-25T13:00:00.000Z",
};

describe("organization event SSE transport", () => {
  it("uses organization sequence as the SSE event id", () => {
    const encoded = formatSseEvent(event);
    expect(encoded).toContain("id: 42\n");
    expect(encoded).toContain("event: task.updated\n");
    expect(encoded).toContain(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("accepts a reconnect cursor and rejects malformed cursors", () => {
    expect(parseEventSequenceCursor("42")).toBe(42);
    expect(parseEventSequenceCursor(undefined, 9)).toBe(9);
    expect(() => parseEventSequenceCursor("-1")).toThrow(TypeError);
    expect(() => parseEventSequenceCursor("4.5")).toThrow(TypeError);
    expect(() => parseEventSequenceCursor("NaN")).toThrow(TypeError);
  });
});

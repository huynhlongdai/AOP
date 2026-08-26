import { describe, expect, it } from "vitest";

import { RuntimeRunReportSchema } from "./runtime-report.js";

const ulid = (digit: string) => digit.repeat(26);
const base = {
  schemaVersion: 1,
  protocolVersion: "0.1.0",
  organizationId: `org_${ulid("1")}`,
  taskId: `tsk_${ulid("2")}`,
  runId: `run_${ulid("3")}`,
  agentId: `agt_${ulid("4")}`,
  attempt: 1,
  runtimeId: "provider-runtime-1",
  adapter: "runtime.test",
  status: "succeeded",
  usage: { inputTokens: 10, outputTokens: 5, toolCalls: 0 },
  traceRefs: [],
  commandOutcomes: [],
  startedAt: "2026-08-26T02:30:00.000Z",
  finishedAt: "2026-08-26T02:31:00.000Z",
  createdAt: "2026-08-26T02:31:00.000Z",
} as const;

describe("RuntimeRunReport", () => {
  it("requires exact Context evidence for a successful Run", () => {
    const result = RuntimeRunReportSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "contextManifestId")).toBe(true);
    }
  });

  it("accepts a failed pre-reasoning Run without inventing Context", () => {
    const result = RuntimeRunReportSchema.parse({
      ...base,
      status: "failed",
      failureReason: "Context compilation failed: database unavailable",
      usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0 },
    });
    expect(result.contextManifestId).toBeUndefined();
    expect(result.status).toBe("failed");
  });

  it("accepts a successful Run when exact Context evidence is present", () => {
    const result = RuntimeRunReportSchema.parse({
      ...base,
      contextManifestId: `ctx_${ulid("5")}`,
    });
    expect(result.status).toBe("succeeded");
  });
});

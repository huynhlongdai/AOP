import { describe, expect, it } from "vitest";

import {
  AOP_PROTOCOL_VERSION,
  AgentIdSchema,
  OrganizationIdSchema,
  PrincipalSchema,
  ResourceRefSchema,
} from "./index.js";

const ULID = "00000000000000000000000000";

describe("AOP protocol foundation", () => {
  it("exports protocol version 0.1.0", () => {
    expect(AOP_PROTOCOL_VERSION).toBe("0.1.0");
  });

  it("validates prefixed IDs", () => {
    expect(OrganizationIdSchema.parse(`org_${ULID}`)).toBe(`org_${ULID}`);
    expect(AgentIdSchema.safeParse(`org_${ULID}`).success).toBe(false);
  });

  it("validates principals without allowing unknown fields", () => {
    expect(PrincipalSchema.parse({ type: "agent", id: `agt_${ULID}` })).toEqual({
      type: "agent",
      id: `agt_${ULID}`,
    });

    expect(
      PrincipalSchema.safeParse({ type: "system", id: "kernel", authority: "root" }).success,
    ).toBe(false);
  });

  it("keeps resource type and ID prefix aligned", () => {
    expect(ResourceRefSchema.safeParse({ type: "task", id: `tsk_${ULID}` }).success).toBe(true);
    expect(ResourceRefSchema.safeParse({ type: "task", id: `agt_${ULID}` }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  AgentSchema,
  OrganizationMembershipSchema,
  OrganizationSchema,
  RoleSchema,
} from "./organization.js";

const ULID = "00000000000000000000000000";
const now = "2026-08-25T12:00:00+07:00";

describe("organization protocol schemas", () => {
  it("accepts a bounded organization definition", () => {
    expect(
      OrganizationSchema.parse({
        id: `org_${ULID}`,
        name: "AOP Labs",
        type: "company",
        status: "active",
        mission: "Build the Agent Organization Protocol.",
        owner: { type: "human", id: `usr_${ULID}` },
        autonomyLevel: "assistant_managed",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      }).name,
    ).toBe("AOP Labs");
  });

  it("rejects duplicate agent capability claims", () => {
    const result = AgentSchema.safeParse({
      id: `agt_${ULID}`,
      name: "Backend Agent",
      version: "0.1.0",
      capabilities: ["code.backend", "code.backend"],
      runtime: { adapter: "runtime.openai" },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });

  it("requires leftAt when membership is left", () => {
    expect(
      OrganizationMembershipSchema.safeParse({
        id: `mem_${ULID}`,
        organizationId: `org_${ULID}`,
        agentId: `agt_${ULID}`,
        status: "left",
        joinedAt: now,
        revision: 2,
      }).success,
    ).toBe(false);
  });

  it("keeps authority categories explicit on roles", () => {
    const role = RoleSchema.parse({
      id: `rol_${ULID}`,
      organizationId: `org_${ULID}`,
      name: "Backend Engineer",
      purpose: "Implement bounded backend work.",
      responsibilities: ["Implement assigned backend tasks"],
      authority: {
        allowedCapabilities: ["git.branch.create", "git.commit.write"],
        approvalRequiredCapabilities: ["deploy.staging"],
        deniedCapabilities: ["deploy.production"],
      },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });

    expect(role.authority.approvalRequiredCapabilities).toContain("deploy.staging");
  });
});

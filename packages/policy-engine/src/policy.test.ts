import { describe, expect, it } from "vitest";

import type { Permission, Role } from "@aop/protocol";

import { evaluatePolicy } from "./policy.js";

const IDs = {
  zero: "00000000000000000000000000",
  one: "00000000000000000000000001",
} as const;
const org = `org_${IDs.zero}` as const;
const agent = { type: "agent", id: `agt_${IDs.zero}` } as const;
const human = { type: "human", id: `usr_${IDs.zero}` } as const;
const now = "2026-08-25T12:00:00+07:00";

const role: Role = {
  id: `rol_${IDs.zero}`,
  organizationId: org,
  name: "Backend Engineer",
  purpose: "Implement bounded backend work",
  responsibilities: ["Implement backend tasks"],
  authority: {
    allowedCapabilities: ["git.commit.write", "deploy.staging"],
    approvalRequiredCapabilities: [],
    deniedCapabilities: ["deploy.production"],
  },
  revision: 0,
  createdAt: now,
  updatedAt: now,
};

const permission = (overrides: Partial<Permission> = {}): Permission => ({
  id: `per_${IDs.zero}`,
  organizationId: org,
  principal: agent,
  capability: "git.commit.write",
  effect: "allow",
  conditions: {},
  grantedBy: human,
  revision: 0,
  createdAt: now,
  ...overrides,
});

const base = {
  organizationId: org,
  principal: agent,
  resource: undefined,
  permissions: [] as Permission[],
  resolvedRoles: [role],
  now,
  context: {},
};

describe("Policy Engine", () => {
  it("defaults to deny", () => {
    const decision = evaluatePolicy({ ...base, capability: "billing.change", resolvedRoles: [] });
    expect(decision.effect).toBe("deny");
    expect(decision.source).toBe("default");
  });

  it("explicit or role deny wins over allow", () => {
    const explicitAllow = permission({ capability: "deploy.production", effect: "allow" });
    const decision = evaluatePolicy({
      ...base,
      capability: "deploy.production",
      permissions: [explicitAllow],
    });
    expect(decision.effect).toBe("deny");
    expect(decision.source).toBe("role");
  });

  it("require_approval wins over allow", () => {
    const gated = permission({ capability: "deploy.staging", effect: "require_approval" });
    const decision = evaluatePolicy({ ...base, capability: "deploy.staging", permissions: [gated] });
    expect(decision.effect).toBe("require_approval");
    expect(decision.source).toBe("permission");
  });

  it("respects resource scope", () => {
    const scoped = permission({
      resource: { type: "task", id: `tsk_${IDs.zero}` },
    });
    const decision = evaluatePolicy({
      ...base,
      capability: "git.commit.write",
      resolvedRoles: [],
      permissions: [scoped],
      resource: { type: "task", id: `tsk_${IDs.one}` },
    });
    expect(decision.effect).toBe("deny");
  });

  it("ignores expired permission", () => {
    const expired = permission({ expiresAt: "2026-08-25T11:59:00+07:00" });
    const decision = evaluatePolicy({
      ...base,
      capability: "git.commit.write",
      resolvedRoles: [],
      permissions: [expired],
    });
    expect(decision.effect).toBe("deny");
  });
});

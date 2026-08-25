import { describe, expect, it } from "vitest";

import {
  ApprovalRequestSchema,
  ArtifactVersionSchema,
  DecisionSchema,
  PermissionSchema,
  ReviewSchema,
} from "./truth.js";

const ULID = "00000000000000000000000000";
const now = "2026-08-25T12:00:00+07:00";
const checksum = `sha256:${"0".repeat(64)}`;

describe("organizational truth schemas", () => {
  it("requires approval metadata on approved artifact versions", () => {
    expect(
      ArtifactVersionSchema.safeParse({
        id: `arv_${ULID}`,
        organizationId: `org_${ULID}`,
        artifactId: `art_${ULID}`,
        version: 4,
        status: "approved",
        createdBy: { type: "agent", id: `agt_${ULID}` },
        content: { uri: "aop://org/artifacts/api/4", mimeType: "application/json", checksum, sizeBytes: 512 },
        derivedFromVersionIds: [],
        createdAt: now,
      }).success,
    ).toBe(false);
  });

  it("requires an active decision to select a real option", () => {
    expect(
      DecisionSchema.safeParse({
        id: `dec_${ULID}`,
        organizationId: `org_${ULID}`,
        scope: "engineering.architecture",
        question: "Which API contract should be active?",
        options: [{ id: "v4", label: "Adopt v4" }],
        selectedOptionId: "v3",
        rationale: "Prefer explicit token rotation.",
        proposedBy: { type: "agent", id: `agt_${ULID}` },
        authorityCapability: "decision.engineering.approve",
        status: "active",
        approvedBy: { type: "agent", id: `agt_${ULID}` },
        effectiveAt: now,
        affectedResources: [],
        revision: 2,
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(false);
  });

  it("requires superseded decisions to preserve approval history", () => {
    expect(
      DecisionSchema.safeParse({
        id: `dec_${ULID}`,
        organizationId: `org_${ULID}`,
        scope: "engineering.architecture",
        question: "Which API contract should be active?",
        options: [{ id: "v4", label: "Adopt v4" }],
        selectedOptionId: "v4",
        rationale: "Historical rationale",
        proposedBy: { type: "agent", id: `agt_${ULID}` },
        authorityCapability: "decision.engineering.approve",
        status: "superseded",
        affectedResources: [],
        revision: 3,
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(false);
  });

  it("requires completedAt for completed reviews", () => {
    expect(
      ReviewSchema.safeParse({
        id: `rev_${ULID}`,
        organizationId: `org_${ULID}`,
        subject: { type: "task", id: `tsk_${ULID}` },
        reviewer: { type: "agent", id: `agt_${ULID}` },
        criteria: [{ key: "tests.pass", description: "Automated tests pass", required: true }],
        evidence: [],
        result: "rework",
        findings: ["Gateway dependency is unresolved"],
        createdAt: now,
        revision: 1,
      }).success,
    ).toBe(false);
  });

  it("requires evidence for a passing review", () => {
    expect(
      ReviewSchema.safeParse({
        id: `rev_${ULID}`,
        organizationId: `org_${ULID}`,
        subject: { type: "task", id: `tsk_${ULID}` },
        reviewer: { type: "agent", id: `agt_${ULID}` },
        criteria: [{ key: "tests.pass", description: "Automated tests pass", required: true }],
        evidence: [],
        result: "pass",
        findings: [],
        createdAt: now,
        completedAt: now,
        revision: 1,
      }).success,
    ).toBe(false);
  });

  it("requires findings for rework and failed reviews", () => {
    for (const result of ["rework", "fail"] as const) {
      expect(
        ReviewSchema.safeParse({
          id: `rev_${ULID}`,
          organizationId: `org_${ULID}`,
          subject: { type: "task", id: `tsk_${ULID}` },
          reviewer: { type: "agent", id: `agt_${ULID}` },
          criteria: [{ key: "tests.pass", description: "Automated tests pass", required: true }],
          evidence: [],
          result,
          findings: [],
          createdAt: now,
          completedAt: now,
          revision: 1,
        }).success,
      ).toBe(false);
    }
  });

  it("models permission effect independently from the principal identity", () => {
    expect(
      PermissionSchema.parse({
        id: `per_${ULID}`,
        organizationId: `org_${ULID}`,
        principal: { type: "agent", id: `agt_${ULID}` },
        capability: "deploy.staging",
        effect: "require_approval",
        conditions: { environment: "staging" },
        grantedBy: { type: "human", id: `usr_${ULID}` },
        revision: 0,
        createdAt: now,
      }).effect,
    ).toBe("require_approval");
  });

  it("prevents an agent from deciding a human-required approval at schema boundary", () => {
    expect(
      ApprovalRequestSchema.safeParse({
        id: `apr_${ULID}`,
        organizationId: `org_${ULID}`,
        commandId: `cmd_${ULID}`,
        commandType: "production.deploy.staging",
        requestedBy: { type: "agent", id: `agt_${ULID}` },
        policyRule: "deploy.protected_environment",
        requiredAuthority: "human",
        risk: "high",
        evidence: [],
        impactSummary: "Deploy authentication service to shared staging.",
        status: "approved",
        decidedBy: { type: "agent", id: `agt_${ULID}` },
        decidedAt: now,
        revision: 1,
        createdAt: now,
      }).success,
    ).toBe(false);
  });

  it("rejects decision metadata on expired or cancelled approvals", () => {
    for (const status of ["expired", "cancelled"] as const) {
      expect(
        ApprovalRequestSchema.safeParse({
          id: `apr_${ULID}`,
          organizationId: `org_${ULID}`,
          commandId: `cmd_${ULID}`,
          commandType: "production.deploy.staging",
          requestedBy: { type: "agent", id: `agt_${ULID}` },
          policyRule: "deploy.protected_environment",
          requiredAuthority: "human",
          risk: "high",
          evidence: [],
          impactSummary: "Deploy authentication service to shared staging.",
          status,
          decidedBy: { type: "human", id: `usr_${ULID}` },
          decidedAt: now,
          revision: 1,
          createdAt: now,
        }).success,
      ).toBe(false);
    }
  });
});

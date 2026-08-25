import { describe, expect, it } from "vitest";

import type { Artifact, ArtifactVersion, Decision, Review } from "@aop/protocol";

import { DomainError } from "./errors.js";
import { activateDecision, approveArtifactVersion, resolveReview } from "./truth-state.js";

const IDs = {
  zero: "00000000000000000000000000",
  one: "00000000000000000000000001",
  two: "00000000000000000000000002",
} as const;
const now = "2026-08-25T12:00:00+07:00";
const checksum = `sha256:${"0".repeat(64)}`;
const principal = { type: "agent", id: `agt_${IDs.zero}` } as const;

const artifact: Artifact = {
  id: `art_${IDs.zero}`,
  organizationId: `org_${IDs.zero}`,
  type: "api.spec",
  title: "API Specification",
  currentApprovedVersionId: `arv_${IDs.one}`,
  revision: 3,
  createdAt: now,
  updatedAt: now,
};

const v1: ArtifactVersion = {
  id: `arv_${IDs.one}`,
  organizationId: artifact.organizationId,
  artifactId: artifact.id,
  version: 1,
  status: "approved",
  createdBy: principal,
  content: { uri: "aop://api/1", mimeType: "application/json", checksum, sizeBytes: 10 },
  derivedFromVersionIds: [],
  approvedBy: principal,
  approvedAt: now,
  createdAt: now,
};

const v2: ArtifactVersion = {
  id: `arv_${IDs.two}`,
  organizationId: artifact.organizationId,
  artifactId: artifact.id,
  version: 2,
  status: "in_review",
  createdBy: principal,
  content: { uri: "aop://api/2", mimeType: "application/json", checksum, sizeBytes: 20 },
  supersedesVersionId: v1.id,
  derivedFromVersionIds: [v1.id],
  createdAt: now,
};

describe("organizational truth lifecycles", () => {
  it("approves a new Artifact version and preserves historical approval on superseded version", () => {
    const result = approveArtifactVersion(artifact, v2, principal, now, 3, v1);
    expect(result.artifact.currentApprovedVersionId).toBe(v2.id);
    expect(result.version.status).toBe("approved");
    expect(result.supersededVersion?.status).toBe("superseded");
    expect(result.supersededVersion?.approvedBy).toEqual(principal);
  });

  it("activates only an approval-pending Decision", () => {
    const decision: Decision = {
      id: `dec_${IDs.zero}`,
      organizationId: artifact.organizationId,
      scope: "engineering.architecture",
      question: "Use contract v2?",
      options: [{ id: "yes", label: "Adopt v2" }],
      proposedBy: principal,
      authorityCapability: "decision.engineering.approve",
      status: "proposed",
      affectedResources: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };

    expect(() => activateDecision(decision, "yes", "Improves contract", principal, now, 0)).toThrow(DomainError);
  });

  it("requires evidence before a Review can pass", () => {
    const review: Review = {
      id: `rev_${IDs.zero}`,
      organizationId: artifact.organizationId,
      subject: { type: "task", id: `tsk_${IDs.zero}` },
      reviewer: principal,
      criteria: [{ key: "tests.pass", description: "Tests pass", required: true }],
      evidence: [],
      result: "pending",
      findings: [],
      createdAt: now,
      revision: 0,
    };

    expect(() => resolveReview(review, "pass", [], [], 0, now)).toThrow(DomainError);
    const passed = resolveReview(review, "pass", [{ type: "artifact_version", id: v2.id }], [], 0, now);
    expect(passed.result).toBe("pass");
  });
});

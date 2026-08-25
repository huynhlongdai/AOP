import {
  ArtifactSchema,
  ArtifactVersionSchema,
  DecisionSchema,
  ReviewSchema,
  type Artifact,
  type ArtifactVersion,
  type Decision,
  type Principal,
  type ResourceRef,
  type Review,
} from "@aop/protocol";

import { assertExpectedRevision, invariant } from "./errors.js";

function assertArtifactVersionBelongsToArtifact(artifact: Artifact, version: ArtifactVersion): void {
  invariant(version.organizationId === artifact.organizationId, "Artifact version organization mismatch", {
    artifactId: artifact.id,
    versionId: version.id,
  });
  invariant(version.artifactId === artifact.id, "Artifact version belongs to another Artifact", {
    artifactId: artifact.id,
    versionArtifactId: version.artifactId,
  });
}

function bumpArtifact(artifact: Artifact, expectedRevision: number, updatedAt: string): Artifact {
  assertExpectedRevision(artifact.revision, expectedRevision);
  return ArtifactSchema.parse({
    ...artifact,
    revision: artifact.revision + 1,
    updatedAt,
  });
}

export interface ArtifactLifecycleResult {
  readonly artifact: Artifact;
  readonly version: ArtifactVersion;
}

export interface ArtifactApprovalResult extends ArtifactLifecycleResult {
  readonly supersededVersion?: ArtifactVersion;
}

export type ArtifactCreateInput = Omit<Artifact, "revision" | "currentApprovedVersionId">;

export function createArtifactWithInitialDraft(
  input: ArtifactCreateInput,
  version: ArtifactVersion,
): ArtifactLifecycleResult {
  const artifact = ArtifactSchema.parse({ ...input, revision: 0 });
  assertArtifactVersionBelongsToArtifact(artifact, version);
  invariant(version.version === 1, "Initial Artifact version must be version 1", {
    artifactId: artifact.id,
    version: version.version,
  });
  invariant(version.status === "draft", "Initial Artifact version must be draft", {
    artifactId: artifact.id,
    versionId: version.id,
    status: version.status,
  });
  invariant(version.supersedesVersionId === undefined, "Initial Artifact version cannot supersede another version", {
    artifactId: artifact.id,
    versionId: version.id,
  });

  return { artifact, version: ArtifactVersionSchema.parse(version) };
}

export function addArtifactDraftVersion(
  artifact: Artifact,
  version: ArtifactVersion,
  previousVersion: Pick<ArtifactVersion, "id" | "version">,
  expectedArtifactRevision: number,
  updatedAt: string,
): ArtifactLifecycleResult {
  assertArtifactVersionBelongsToArtifact(artifact, version);
  invariant(version.status === "draft", "New Artifact revision must start as draft", {
    artifactId: artifact.id,
    versionId: version.id,
    status: version.status,
  });
  invariant(version.version === previousVersion.version + 1, "Artifact versions must be contiguous", {
    artifactId: artifact.id,
    previousVersion: previousVersion.version,
    nextVersion: version.version,
  });
  invariant(version.supersedesVersionId === previousVersion.id, "Artifact revision must supersede the latest version", {
    artifactId: artifact.id,
    expectedSupersedesVersionId: previousVersion.id,
    actualSupersedesVersionId: version.supersedesVersionId,
  });

  return {
    artifact: bumpArtifact(artifact, expectedArtifactRevision, updatedAt),
    version: ArtifactVersionSchema.parse(version),
  };
}

export function submitArtifactVersionForReview(
  artifact: Artifact,
  version: ArtifactVersion,
  expectedArtifactRevision: number,
  updatedAt: string,
): ArtifactLifecycleResult {
  assertArtifactVersionBelongsToArtifact(artifact, version);
  invariant(version.status === "draft", "Only draft Artifact versions can enter review", {
    versionId: version.id,
    status: version.status,
  });

  return {
    artifact: bumpArtifact(artifact, expectedArtifactRevision, updatedAt),
    version: ArtifactVersionSchema.parse({ ...version, status: "in_review" }),
  };
}

export function approveArtifactVersion(
  artifact: Artifact,
  version: ArtifactVersion,
  approver: Principal,
  approvedAt: string,
  expectedArtifactRevision: number,
  previousCurrentVersion?: ArtifactVersion,
): ArtifactApprovalResult {
  assertArtifactVersionBelongsToArtifact(artifact, version);
  invariant(version.status === "in_review", "Only in-review Artifact versions can be approved", {
    versionId: version.id,
    status: version.status,
  });

  if (artifact.currentApprovedVersionId !== undefined) {
    invariant(previousCurrentVersion !== undefined, "Current approved Artifact version must be supplied for supersession", {
      currentApprovedVersionId: artifact.currentApprovedVersionId,
    });
    assertArtifactVersionBelongsToArtifact(artifact, previousCurrentVersion);
    invariant(
      previousCurrentVersion.id === artifact.currentApprovedVersionId,
      "Supplied previous version does not match Artifact current approved version",
      { expected: artifact.currentApprovedVersionId, actual: previousCurrentVersion.id },
    );
    invariant(previousCurrentVersion.status === "approved", "Current Artifact version must be approved before supersession", {
      versionId: previousCurrentVersion.id,
      status: previousCurrentVersion.status,
    });
  } else {
    invariant(previousCurrentVersion === undefined, "Previous current version supplied for Artifact without a current approved version");
  }

  const updatedArtifact = ArtifactSchema.parse({
    ...bumpArtifact(artifact, expectedArtifactRevision, approvedAt),
    currentApprovedVersionId: version.id,
  });

  const approvedVersion = ArtifactVersionSchema.parse({
    ...version,
    status: "approved",
    approvedBy: approver,
    approvedAt,
  });

  const supersededVersion = previousCurrentVersion
    ? ArtifactVersionSchema.parse({ ...previousCurrentVersion, status: "superseded" })
    : undefined;

  return supersededVersion === undefined
    ? { artifact: updatedArtifact, version: approvedVersion }
    : { artifact: updatedArtifact, version: approvedVersion, supersededVersion };
}

export function rejectArtifactVersion(
  artifact: Artifact,
  version: ArtifactVersion,
  expectedArtifactRevision: number,
  updatedAt: string,
): ArtifactLifecycleResult {
  assertArtifactVersionBelongsToArtifact(artifact, version);
  invariant(version.status === "in_review", "Only in-review Artifact versions can be rejected", {
    versionId: version.id,
    status: version.status,
  });

  return {
    artifact: bumpArtifact(artifact, expectedArtifactRevision, updatedAt),
    version: ArtifactVersionSchema.parse({ ...version, status: "rejected" }),
  };
}

export type DecisionCreateInput = Omit<Decision, "revision">;

export function createDecision(input: DecisionCreateInput): Decision {
  return DecisionSchema.parse({ ...input, revision: 0 });
}

function transitionDecision(
  current: Decision,
  nextStatus: Decision["status"],
  allowedCurrentStates: readonly Decision["status"][],
  expectedRevision: number,
  updatedAt: string,
): Decision {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(allowedCurrentStates.includes(current.status), `Cannot move Decision ${current.status} -> ${nextStatus}`, {
    decisionId: current.id,
    currentStatus: current.status,
    nextStatus,
  });

  return DecisionSchema.parse({
    ...current,
    status: nextStatus,
    revision: current.revision + 1,
    updatedAt,
  });
}

export function openDecisionDiscussion(current: Decision, expectedRevision: number, updatedAt: string): Decision {
  return transitionDecision(current, "discussion", ["proposed"], expectedRevision, updatedAt);
}

export function requestDecisionApproval(current: Decision, expectedRevision: number, updatedAt: string): Decision {
  return transitionDecision(current, "approval_pending", ["proposed", "discussion"], expectedRevision, updatedAt);
}

export function activateDecision(
  current: Decision,
  selectedOptionId: string,
  rationale: string,
  approvedBy: Principal,
  effectiveAt: string,
  expectedRevision: number,
): Decision {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(current.status === "approval_pending", "Only approval-pending Decisions can become active", {
    decisionId: current.id,
    status: current.status,
  });
  invariant(current.options.some((option) => option.id === selectedOptionId), "Selected Decision option does not exist", {
    decisionId: current.id,
    selectedOptionId,
  });

  return DecisionSchema.parse({
    ...current,
    selectedOptionId,
    rationale,
    approvedBy,
    effectiveAt,
    status: "active",
    revision: current.revision + 1,
    updatedAt: effectiveAt,
  });
}

export function supersedeDecision(current: Decision, expectedRevision: number, updatedAt: string): Decision {
  return transitionDecision(current, "superseded", ["active"], expectedRevision, updatedAt);
}

export function rejectDecision(current: Decision, expectedRevision: number, updatedAt: string): Decision {
  return transitionDecision(current, "rejected", ["proposed", "discussion", "approval_pending"], expectedRevision, updatedAt);
}

export type ReviewCreateInput = Omit<Review, "revision">;
export type FinalReviewResult = Exclude<Review["result"], "pending">;

export function createReview(input: ReviewCreateInput): Review {
  invariant(input.result === "pending", "New Reviews must start pending");
  return ReviewSchema.parse({ ...input, revision: 0 });
}

export function resolveReview(
  current: Review,
  result: FinalReviewResult,
  evidence: readonly ResourceRef[],
  findings: readonly string[],
  expectedRevision: number,
  completedAt: string,
): Review {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(current.result === "pending", "Only pending Reviews can be resolved", {
    reviewId: current.id,
    result: current.result,
  });
  if (result === "pass") {
    invariant(evidence.length > 0, "Passing a Review requires evidence", { reviewId: current.id });
  } else {
    invariant(findings.length > 0, `${result} Review requires at least one finding`, { reviewId: current.id });
  }

  return ReviewSchema.parse({
    ...current,
    result,
    evidence: [...evidence],
    findings: [...findings],
    completedAt,
    revision: current.revision + 1,
  });
}

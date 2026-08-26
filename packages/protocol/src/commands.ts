import * as z from "zod";

import {
  AgentIdSchema,
  ArtifactIdSchema,
  ArtifactVersionIdSchema,
  ContextManifestIdSchema,
  DecisionIdSchema,
  LeaseIdSchema,
  ReviewIdSchema,
  TaskIdSchema,
  TaskRunIdSchema,
} from "./ids.js";
import { ResourceRefSchema } from "./resource-ref.js";
import {
  RuntimeCommandOutcomeEvidenceSchema,
  RuntimeTraceRefSchema,
  RuntimeUsageSchema,
} from "./runtime-report.js";

const CapabilityTokenSchema = z.string().min(2).max(128).regex(/^[a-z][a-z0-9_.:-]+$/);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const ArtifactContentInputSchema = z
  .object({
    uri: z.string().trim().min(1).max(2_000),
    mimeType: z.string().trim().min(1).max(160),
    checksum: Sha256Schema,
    sizeBytes: z.number().int().nonnegative(),
    schema: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

const ArtifactProductionFieldsSchema = {
  producedByTaskId: TaskIdSchema.optional(),
  deliverableType: CapabilityTokenSchema.optional(),
  derivedFromVersionIds: z.array(ArtifactVersionIdSchema).max(64).default([]),
};

const ReviewCriterionInputSchema = z
  .object({
    key: CapabilityTokenSchema,
    description: z.string().trim().min(1).max(500),
    required: z.boolean(),
  })
  .strict();

const DecisionOptionInputSchema = z
  .object({
    id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.:-]+$/),
    label: z.string().trim().min(1).max(240),
    description: z.string().trim().max(2_000).optional(),
  })
  .strict();

function validateArtifactProduction(
  payload: { producedByTaskId?: unknown; deliverableType?: unknown; derivedFromVersionIds: readonly string[] },
  ctx: z.RefinementCtx,
): void {
  if ((payload.producedByTaskId === undefined) !== (payload.deliverableType === undefined)) {
    ctx.addIssue({
      code: "custom",
      path: [payload.producedByTaskId === undefined ? "producedByTaskId" : "deliverableType"],
      message: "producedByTaskId and deliverableType must be supplied together",
    });
  }
  if (new Set(payload.derivedFromVersionIds).size !== payload.derivedFromVersionIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["derivedFromVersionIds"],
      message: "derivedFromVersionIds cannot contain duplicates",
    });
  }
}

export const TaskClaimPayloadSchema = z
  .object({
    agentId: AgentIdSchema,
    runId: TaskRunIdSchema,
    leaseId: LeaseIdSchema,
    attempt: z.number().int().positive(),
    runtimeType: CapabilityTokenSchema,
    workspaceId: z.string().trim().min(1).max(240),
    leaseSeconds: z.number().int().min(30).max(3_600),
    heartbeatIntervalSeconds: z.number().int().min(5).max(3_600),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.heartbeatIntervalSeconds >= payload.leaseSeconds) {
      ctx.addIssue({
        code: "custom",
        path: ["heartbeatIntervalSeconds"],
        message: "heartbeatIntervalSeconds must be shorter than leaseSeconds",
      });
    }
  });

export const TaskRunPreparePayloadSchema = z
  .object({
    runtimeId: z.string().trim().min(1).max(240),
    adapter: CapabilityTokenSchema,
    provider: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(160).optional(),
    traceRefs: z.array(RuntimeTraceRefSchema).max(128).default([]),
  })
  .strict();

export const TaskRunStartPayloadSchema = z
  .object({
    taskExpectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const TaskRunFinishPayloadSchema = z
  .object({
    taskExpectedRevision: z.number().int().nonnegative(),
    contextManifestId: ContextManifestIdSchema.optional(),
    runtimeId: z.string().trim().min(1).max(240),
    adapter: CapabilityTokenSchema,
    provider: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(160).optional(),
    status: z.enum(["succeeded", "failed", "cancelled"]),
    usage: RuntimeUsageSchema,
    traceRefs: z.array(RuntimeTraceRefSchema).max(256).default([]),
    commandOutcomes: z.array(RuntimeCommandOutcomeEvidenceSchema).max(256).default([]),
    failureReason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.status === "failed" && payload.failureReason === undefined) {
      ctx.addIssue({ code: "custom", path: ["failureReason"], message: "failed TaskRun requires failureReason" });
    }
    if (payload.status === "succeeded" && payload.failureReason !== undefined) {
      ctx.addIssue({ code: "custom", path: ["failureReason"], message: "succeeded TaskRun cannot include failureReason" });
    }
    if (payload.status === "succeeded" && payload.contextManifestId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["contextManifestId"],
        message: "succeeded TaskRun requires exact Context Manifest evidence",
      });
    }
  });

export const TaskSubmitReviewPayloadSchema = z
  .object({
    reviewId: ReviewIdSchema,
    criteria: z.array(ReviewCriterionInputSchema).min(1).max(64),
  })
  .strict();

export const ReviewResolvePayloadSchema = z
  .object({
    taskExpectedRevision: z.number().int().nonnegative(),
    result: z.enum(["pass", "rework", "fail"]),
    evidence: z.array(ResourceRefSchema).max(128).default([]),
    findings: z.array(z.string().trim().min(1).max(1_000)).max(128).default([]),
  })
  .strict();

export const LeaseHeartbeatPayloadSchema = z
  .object({
    extendSeconds: z.number().int().min(30).max(3_600),
  })
  .strict();

export const LeaseExpirePayloadSchema = z.object({}).strict();

export const ArtifactCreatePayloadSchema = z
  .object({
    artifactId: ArtifactIdSchema,
    versionId: ArtifactVersionIdSchema,
    type: CapabilityTokenSchema,
    title: z.string().trim().min(1).max(240),
    content: ArtifactContentInputSchema,
    ...ArtifactProductionFieldsSchema,
  })
  .strict()
  .superRefine(validateArtifactProduction);

export const ArtifactRevisePayloadSchema = z
  .object({
    versionId: ArtifactVersionIdSchema,
    content: ArtifactContentInputSchema,
    ...ArtifactProductionFieldsSchema,
  })
  .strict()
  .superRefine(validateArtifactProduction);

export const ArtifactSubmitReviewPayloadSchema = z
  .object({
    versionId: ArtifactVersionIdSchema,
  })
  .strict();

export const ArtifactApprovePayloadSchema = z
  .object({
    versionId: ArtifactVersionIdSchema,
  })
  .strict();

export const ArtifactRejectPayloadSchema = z
  .object({
    versionId: ArtifactVersionIdSchema,
  })
  .strict();

export const DecisionCreatePayloadSchema = z
  .object({
    decisionId: DecisionIdSchema,
    scope: CapabilityTokenSchema,
    question: z.string().trim().min(1).max(4_000),
    options: z.array(DecisionOptionInputSchema).min(1).max(32),
    authorityCapability: CapabilityTokenSchema,
    affectedResources: z.array(ResourceRefSchema).max(256).default([]),
    supersedesDecisionId: DecisionIdSchema.optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.supersedesDecisionId === payload.decisionId) {
      ctx.addIssue({
        code: "custom",
        path: ["supersedesDecisionId"],
        message: "Decision cannot supersede itself",
      });
    }
    const optionIds = payload.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Decision option IDs must be unique" });
    }
  });

export const DecisionRequestApprovalPayloadSchema = z.object({}).strict();

export const DecisionActivatePayloadSchema = z
  .object({
    selectedOptionId: z.string().min(1).max(64),
    rationale: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const DecisionRejectPayloadSchema = z.object({}).strict();

export type TaskClaimPayload = z.infer<typeof TaskClaimPayloadSchema>;
export type TaskRunPreparePayload = z.infer<typeof TaskRunPreparePayloadSchema>;
export type TaskRunStartPayload = z.infer<typeof TaskRunStartPayloadSchema>;
export type TaskRunFinishPayload = z.infer<typeof TaskRunFinishPayloadSchema>;
export type TaskSubmitReviewPayload = z.infer<typeof TaskSubmitReviewPayloadSchema>;
export type ReviewResolvePayload = z.infer<typeof ReviewResolvePayloadSchema>;
export type LeaseHeartbeatPayload = z.infer<typeof LeaseHeartbeatPayloadSchema>;
export type LeaseExpirePayload = z.infer<typeof LeaseExpirePayloadSchema>;
export type ArtifactCreatePayload = z.infer<typeof ArtifactCreatePayloadSchema>;
export type ArtifactRevisePayload = z.infer<typeof ArtifactRevisePayloadSchema>;
export type ArtifactSubmitReviewPayload = z.infer<typeof ArtifactSubmitReviewPayloadSchema>;
export type ArtifactApprovePayload = z.infer<typeof ArtifactApprovePayloadSchema>;
export type ArtifactRejectPayload = z.infer<typeof ArtifactRejectPayloadSchema>;
export type DecisionCreatePayload = z.infer<typeof DecisionCreatePayloadSchema>;
export type DecisionRequestApprovalPayload = z.infer<typeof DecisionRequestApprovalPayloadSchema>;
export type DecisionActivatePayload = z.infer<typeof DecisionActivatePayloadSchema>;
export type DecisionRejectPayload = z.infer<typeof DecisionRejectPayloadSchema>;

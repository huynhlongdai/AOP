import * as z from "zod";

import {
  ApprovalRequestIdSchema,
  ArtifactIdSchema,
  ArtifactVersionIdSchema,
  CommandIdSchema,
  DecisionIdSchema,
  OrganizationIdSchema,
  PermissionIdSchema,
  ReviewIdSchema,
  TaskIdSchema,
} from "./ids.js";
import { HumanPrincipalSchema, PrincipalSchema } from "./principal.js";
import { ResourceRefSchema } from "./resource-ref.js";

const TimestampSchema = z.iso.datetime({ offset: true });
const CapabilityTokenSchema = z.string().min(2).max(128).regex(/^[a-z][a-z0-9_.:-]+$/);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const ArtifactStatusSchema = z.enum(["draft", "in_review", "approved", "superseded", "rejected"]);

export const ArtifactSchema = z
  .object({
    id: ArtifactIdSchema,
    organizationId: OrganizationIdSchema,
    type: CapabilityTokenSchema,
    title: z.string().trim().min(1).max(240),
    currentApprovedVersionId: ArtifactVersionIdSchema.optional(),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const ArtifactVersionSchema = z
  .object({
    id: ArtifactVersionIdSchema,
    organizationId: OrganizationIdSchema,
    artifactId: ArtifactIdSchema,
    version: z.number().int().positive(),
    status: ArtifactStatusSchema,
    createdBy: PrincipalSchema,
    producedByTaskId: TaskIdSchema.optional(),
    content: z
      .object({
        uri: z.string().trim().min(1).max(2_000),
        mimeType: z.string().trim().min(1).max(160),
        checksum: Sha256Schema,
        sizeBytes: z.number().int().nonnegative(),
        schema: z.string().trim().min(1).max(240).optional(),
      })
      .strict(),
    supersedesVersionId: ArtifactVersionIdSchema.optional(),
    derivedFromVersionIds: z.array(ArtifactVersionIdSchema).max(64),
    approvedBy: PrincipalSchema.optional(),
    approvedAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((version, ctx) => {
    const preservesApprovalHistory = version.status === "approved" || version.status === "superseded";
    if (preservesApprovalHistory && (version.approvedBy === undefined || version.approvedAt === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["approvedBy"],
        message: "approved and superseded artifact versions require historical approver and approvedAt",
      });
    }
    if (!preservesApprovalHistory && (version.approvedBy !== undefined || version.approvedAt !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["approvedBy"],
        message: "approval metadata is only valid for approved or superseded versions",
      });
    }
  });

export const DecisionStatusSchema = z.enum([
  "proposed",
  "discussion",
  "approval_pending",
  "active",
  "rejected",
  "superseded",
]);

export const DecisionOptionSchema = z
  .object({
    id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.:-]+$/),
    label: z.string().trim().min(1).max(240),
    description: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const DecisionSchema = z
  .object({
    id: DecisionIdSchema,
    organizationId: OrganizationIdSchema,
    scope: CapabilityTokenSchema,
    question: z.string().trim().min(1).max(4_000),
    options: z.array(DecisionOptionSchema).min(1).max(32),
    selectedOptionId: z.string().min(1).max(64).optional(),
    rationale: z.string().trim().min(1).max(4_000).optional(),
    proposedBy: PrincipalSchema,
    authorityCapability: CapabilityTokenSchema,
    status: DecisionStatusSchema,
    approvedBy: PrincipalSchema.optional(),
    effectiveAt: TimestampSchema.optional(),
    supersedesDecisionId: DecisionIdSchema.optional(),
    affectedResources: z.array(ResourceRefSchema).max(256),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.selectedOptionId !== undefined && !decision.options.some((option) => option.id === decision.selectedOptionId)) {
      ctx.addIssue({ code: "custom", path: ["selectedOptionId"], message: "selectedOptionId must reference one of the decision options" });
    }

    if (decision.status === "active") {
      if (decision.selectedOptionId === undefined) {
        ctx.addIssue({ code: "custom", path: ["selectedOptionId"], message: "active decisions require a selected option" });
      }
      if (decision.rationale === undefined) {
        ctx.addIssue({ code: "custom", path: ["rationale"], message: "active decisions require rationale" });
      }
      if (decision.approvedBy === undefined || decision.effectiveAt === undefined) {
        ctx.addIssue({ code: "custom", path: ["approvedBy"], message: "active decisions require approval metadata" });
      }
    }
  });

export const ReviewResultSchema = z.enum(["pending", "pass", "rework", "fail"]);

export const ReviewSchema = z
  .object({
    id: ReviewIdSchema,
    organizationId: OrganizationIdSchema,
    subject: ResourceRefSchema,
    reviewer: PrincipalSchema,
    criteria: z
      .array(
        z
          .object({
            key: CapabilityTokenSchema,
            description: z.string().trim().min(1).max(500),
            required: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    evidence: z.array(ResourceRefSchema).max(128),
    result: ReviewResultSchema,
    findings: z.array(z.string().trim().min(1).max(1_000)).max(128),
    createdAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((review, ctx) => {
    if (review.result === "pending" && review.completedAt !== undefined) {
      ctx.addIssue({ code: "custom", path: ["completedAt"], message: "pending reviews cannot be completed" });
    }
    if (review.result !== "pending" && review.completedAt === undefined) {
      ctx.addIssue({ code: "custom", path: ["completedAt"], message: "completed reviews require completedAt" });
    }
  });

export const PermissionEffectSchema = z.enum(["allow", "require_approval", "deny"]);

export const PermissionSchema = z
  .object({
    id: PermissionIdSchema,
    organizationId: OrganizationIdSchema,
    principal: PrincipalSchema,
    capability: CapabilityTokenSchema,
    effect: PermissionEffectSchema,
    resource: ResourceRefSchema.optional(),
    conditions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    grantedBy: PrincipalSchema,
    expiresAt: TimestampSchema.optional(),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
  })
  .strict();

export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "changes_requested",
  "expired",
  "cancelled",
]);
export const ApprovalRiskSchema = z.enum(["low", "medium", "high", "critical"]);
export const ApprovalAuthoritySchema = z.enum(["human", "manager", "role_capability"]);

export const ApprovalRequestSchema = z
  .object({
    id: ApprovalRequestIdSchema,
    organizationId: OrganizationIdSchema,
    commandId: CommandIdSchema,
    commandType: CapabilityTokenSchema,
    requestedBy: PrincipalSchema,
    target: ResourceRefSchema.optional(),
    policyRule: CapabilityTokenSchema,
    requiredAuthority: ApprovalAuthoritySchema,
    risk: ApprovalRiskSchema,
    evidence: z.array(ResourceRefSchema).max(128),
    impactSummary: z.string().trim().min(1).max(2_000),
    estimatedCostCredits: z.number().nonnegative().optional(),
    status: ApprovalStatusSchema,
    decidedBy: PrincipalSchema.optional(),
    decidedAt: TimestampSchema.optional(),
    decisionNote: z.string().trim().max(2_000).optional(),
    expiresAt: TimestampSchema.optional(),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((approval, ctx) => {
    const decided = approval.status === "approved" || approval.status === "rejected" || approval.status === "changes_requested";
    if (decided && (approval.decidedBy === undefined || approval.decidedAt === undefined)) {
      ctx.addIssue({ code: "custom", path: ["decidedBy"], message: "decided approvals require decidedBy and decidedAt" });
    }
    if (approval.status === "pending" && (approval.decidedBy !== undefined || approval.decidedAt !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["decidedBy"], message: "pending approvals cannot contain decision metadata" });
    }
    if (approval.requiredAuthority === "human" && approval.decidedBy !== undefined && !HumanPrincipalSchema.safeParse(approval.decidedBy).success) {
      ctx.addIssue({ code: "custom", path: ["decidedBy"], message: "human-required approvals must be decided by a human principal" });
    }
  });

export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type PermissionEffect = z.infer<typeof PermissionEffectSchema>;
export type Permission = z.infer<typeof PermissionSchema>;
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

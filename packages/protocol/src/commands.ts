import * as z from "zod";

import {
  AgentIdSchema,
  ArtifactIdSchema,
  ArtifactVersionIdSchema,
  LeaseIdSchema,
  TaskIdSchema,
  TaskRunIdSchema,
} from "./ids.js";

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

export type TaskClaimPayload = z.infer<typeof TaskClaimPayloadSchema>;
export type LeaseHeartbeatPayload = z.infer<typeof LeaseHeartbeatPayloadSchema>;
export type LeaseExpirePayload = z.infer<typeof LeaseExpirePayloadSchema>;
export type ArtifactCreatePayload = z.infer<typeof ArtifactCreatePayloadSchema>;
export type ArtifactRevisePayload = z.infer<typeof ArtifactRevisePayloadSchema>;

import * as z from "zod";

import {
  AgentIdSchema,
  CommandIdSchema,
  ContextManifestIdSchema,
  OrganizationIdSchema,
  TaskIdSchema,
  TaskRunIdSchema,
} from "./ids.js";
import { ResourceRefSchema } from "./resource-ref.js";
import { AOP_PROTOCOL_VERSION } from "./version.js";

const CapabilityTokenSchema = z.string().min(2).max(128).regex(/^[a-z][a-z0-9_.:-]+$/);
const TimestampSchema = z.iso.datetime({ offset: true });

export const RuntimeTraceRefSchema = z
  .object({
    provider: z.string().trim().min(1).max(80),
    traceId: z.string().trim().min(1).max(240),
    spanId: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const RuntimeUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    costCredits: z.number().finite().nonnegative().optional(),
  })
  .strict();

export const RuntimeCommandOutcomeStatusSchema = z.enum([
  "accepted",
  "rejected",
  "not_forwarded",
  "submission_error",
]);

export const RuntimeCommandOutcomeEvidenceSchema = z
  .object({
    proposalIndex: z.number().int().nonnegative(),
    commandType: CapabilityTokenSchema,
    target: ResourceRefSchema.optional(),
    status: RuntimeCommandOutcomeStatusSchema,
    commandId: CommandIdSchema.optional(),
    errorCode: CapabilityTokenSchema.optional(),
    reason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((outcome, ctx) => {
    if ((outcome.status === "accepted" || outcome.status === "rejected") && outcome.commandId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["commandId"],
        message: "forwarded command outcomes require commandId evidence",
      });
    }
    if ((outcome.status === "not_forwarded" || outcome.status === "submission_error") && outcome.reason === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: `${outcome.status} command outcomes require a reason`,
      });
    }
  });

export const RuntimeRunReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(AOP_PROTOCOL_VERSION),
    organizationId: OrganizationIdSchema,
    taskId: TaskIdSchema,
    runId: TaskRunIdSchema,
    agentId: AgentIdSchema,
    attempt: z.number().int().positive(),
    contextManifestId: ContextManifestIdSchema.optional(),
    runtimeId: z.string().trim().min(1).max(240),
    adapter: CapabilityTokenSchema,
    provider: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(160).optional(),
    status: z.enum(["succeeded", "failed", "cancelled"]),
    usage: RuntimeUsageSchema,
    traceRefs: z.array(RuntimeTraceRefSchema).max(256),
    commandOutcomes: z.array(RuntimeCommandOutcomeEvidenceSchema).max(256),
    failureReason: z.string().trim().min(1).max(2_000).optional(),
    startedAt: TimestampSchema,
    finishedAt: TimestampSchema,
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((report, ctx) => {
    if (Date.parse(report.finishedAt) < Date.parse(report.startedAt)) {
      ctx.addIssue({ code: "custom", path: ["finishedAt"], message: "finishedAt cannot precede startedAt" });
    }
    if (Date.parse(report.createdAt) < Date.parse(report.finishedAt)) {
      ctx.addIssue({ code: "custom", path: ["createdAt"], message: "createdAt cannot precede finishedAt" });
    }
    if (report.status === "failed" && report.failureReason === undefined) {
      ctx.addIssue({ code: "custom", path: ["failureReason"], message: "failed Run Report requires failureReason" });
    }
    if (report.status === "succeeded" && report.failureReason !== undefined) {
      ctx.addIssue({ code: "custom", path: ["failureReason"], message: "succeeded Run Report cannot include failureReason" });
    }
    if (report.status === "succeeded" && report.contextManifestId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["contextManifestId"],
        message: "succeeded Run Report requires exact Context Manifest evidence",
      });
    }
    const indexes = report.commandOutcomes.map((outcome) => outcome.proposalIndex);
    if (new Set(indexes).size !== indexes.length) {
      ctx.addIssue({ code: "custom", path: ["commandOutcomes"], message: "proposalIndex values must be unique" });
    }
  });

export type RuntimeTraceRef = z.infer<typeof RuntimeTraceRefSchema>;
export type RuntimeUsage = z.infer<typeof RuntimeUsageSchema>;
export type RuntimeCommandOutcomeStatus = z.infer<typeof RuntimeCommandOutcomeStatusSchema>;
export type RuntimeCommandOutcomeEvidence = z.infer<typeof RuntimeCommandOutcomeEvidenceSchema>;
export type RuntimeRunReport = z.infer<typeof RuntimeRunReportSchema>;

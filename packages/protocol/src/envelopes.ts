import * as z from "zod";

import {
  AgentIdSchema,
  ApprovalRequestIdSchema,
  CommandIdSchema,
  ContextManifestIdSchema,
  EventIdSchema,
  OrganizationIdSchema,
  TaskIdSchema,
  TaskRunIdSchema,
} from "./ids.js";
import { PrincipalSchema } from "./principal.js";
import { ResourceRefSchema } from "./resource-ref.js";
import { ProtocolVersionSchema } from "./version.js";

const TimestampSchema = z.iso.datetime({ offset: true });
const TypeTokenSchema = z.string().min(3).max(160).regex(/^[a-z][a-z0-9_.:-]+$/);
const ArbitraryObjectSchema = z.record(z.string(), z.unknown());

export const EnvelopeSchemaVersionSchema = z.literal(1);

export const CommandEnvelopeSchema = z
  .object({
    schemaVersion: EnvelopeSchemaVersionSchema,
    protocolVersion: ProtocolVersionSchema,
    commandId: CommandIdSchema,
    type: TypeTokenSchema,
    organizationId: OrganizationIdSchema,
    actor: PrincipalSchema,
    target: ResourceRefSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    idempotencyKey: z.string().min(8).max(200).regex(/^[A-Za-z0-9_.:-]+$/),
    payload: ArbitraryObjectSchema,
    issuedAt: TimestampSchema,
  })
  .strict();

export const EventEnvelopeSchema = z
  .object({
    schemaVersion: EnvelopeSchemaVersionSchema,
    protocolVersion: ProtocolVersionSchema,
    eventId: EventIdSchema,
    type: TypeTokenSchema,
    organizationId: OrganizationIdSchema,
    organizationSequence: z.number().int().positive(),
    aggregate: ResourceRefSchema,
    aggregateRevision: z.number().int().nonnegative(),
    actor: PrincipalSchema,
    causationId: CommandIdSchema.optional(),
    correlationId: z.string().min(1).max(200),
    payload: ArbitraryObjectSchema,
    occurredAt: TimestampSchema,
  })
  .strict();

export const ProtocolErrorCodeSchema = z.enum([
  "validation_error",
  "scope_mismatch",
  "revision_conflict",
  "forbidden",
  "approval_required",
  "invariant_violation",
  "not_found",
  "idempotency_conflict",
  "internal_error",
]);

export const ProtocolErrorSchema = z
  .object({
    code: ProtocolErrorCodeSchema,
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
    approvalRequestId: ApprovalRequestIdSchema.optional(),
    details: ArbitraryObjectSchema,
  })
  .strict()
  .superRefine((error, ctx) => {
    if (error.code === "approval_required" && error.approvalRequestId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["approvalRequestId"],
        message: "approval_required errors must reference an approval request",
      });
    }
  });

export const CommandAcceptedSchema = z
  .object({
    ok: z.literal(true),
    commandId: CommandIdSchema,
    resultingRevision: z.number().int().nonnegative().optional(),
    emittedEventIds: z.array(EventIdSchema).max(128),
  })
  .strict();

export const CommandRejectedSchema = z
  .object({
    ok: z.literal(false),
    commandId: CommandIdSchema,
    error: ProtocolErrorSchema,
  })
  .strict();

export const CommandResultSchema = z.discriminatedUnion("ok", [CommandAcceptedSchema, CommandRejectedSchema]);

export const ContextFragmentKindSchema = z.enum([
  "policy",
  "identity",
  "role",
  "goal",
  "task",
  "dependency",
  "decision",
  "artifact",
  "previous_attempt",
  "memory",
  "external_evidence",
  "tool",
  "output_contract",
]);

export const ContextTrustSchema = z.enum(["authoritative", "derived", "untrusted"]);

export const ContextFragmentSchema = z
  .object({
    key: z.string().min(1).max(200),
    kind: ContextFragmentKindSchema,
    trust: ContextTrustSchema,
    source: ResourceRefSchema.optional(),
    sourceRevision: z.number().int().nonnegative().optional(),
    mandatory: z.boolean(),
    authorityWeight: z.number().min(0).max(1),
    relevanceWeight: z.number().min(0).max(1),
    tokenEstimate: z.number().int().nonnegative(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  })
  .strict();

export const ContextManifestSchema = z
  .object({
    schemaVersion: EnvelopeSchemaVersionSchema,
    protocolVersion: ProtocolVersionSchema,
    id: ContextManifestIdSchema,
    organizationId: OrganizationIdSchema,
    taskId: TaskIdSchema,
    runId: TaskRunIdSchema,
    agentId: AgentIdSchema,
    taskRevision: z.number().int().nonnegative(),
    fragments: z.array(ContextFragmentSchema).min(1).max(512),
    totalTokenEstimate: z.number().int().nonnegative(),
    compiledAt: TimestampSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const calculated = manifest.fragments.reduce((sum, fragment) => sum + fragment.tokenEstimate, 0);
    if (calculated !== manifest.totalTokenEstimate) {
      ctx.addIssue({
        code: "custom",
        path: ["totalTokenEstimate"],
        message: `totalTokenEstimate must equal fragment total (${calculated})`,
      });
    }

    const requiredKinds = new Set(["policy", "identity", "role", "goal", "task", "output_contract"]);
    for (const kind of requiredKinds) {
      if (!manifest.fragments.some((fragment) => fragment.kind === kind && fragment.mandatory)) {
        ctx.addIssue({
          code: "custom",
          path: ["fragments"],
          message: `Context Manifest requires mandatory ${kind} fragment`,
        });
      }
    }
  });

export type EnvelopeSchemaVersion = z.infer<typeof EnvelopeSchemaVersionSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCodeSchema>;
export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type ContextFragmentKind = z.infer<typeof ContextFragmentKindSchema>;
export type ContextTrust = z.infer<typeof ContextTrustSchema>;
export type ContextFragment = z.infer<typeof ContextFragmentSchema>;
export type ContextManifest = z.infer<typeof ContextManifestSchema>;

import * as z from "zod";

import { AgentIdSchema, LeaseIdSchema, TaskRunIdSchema } from "./ids.js";

const CapabilityTokenSchema = z.string().min(2).max(128).regex(/^[a-z][a-z0-9_.:-]+$/);

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

export type TaskClaimPayload = z.infer<typeof TaskClaimPayloadSchema>;

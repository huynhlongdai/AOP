import * as z from "zod";

import { AgentIdSchema, UserIdSchema } from "./ids.js";

export const SystemPrincipalIdSchema = z.enum([
  "kernel",
  "scheduler",
  "runtime-manager",
  "outbox-worker",
  "observer",
]);

export const HumanPrincipalSchema = z
  .object({
    type: z.literal("human"),
    id: UserIdSchema,
  })
  .strict();

export const AgentPrincipalSchema = z
  .object({
    type: z.literal("agent"),
    id: AgentIdSchema,
  })
  .strict();

export const SystemPrincipalSchema = z
  .object({
    type: z.literal("system"),
    id: SystemPrincipalIdSchema,
  })
  .strict();

export const PrincipalSchema = z.discriminatedUnion("type", [
  HumanPrincipalSchema,
  AgentPrincipalSchema,
  SystemPrincipalSchema,
]);

export type SystemPrincipalId = z.infer<typeof SystemPrincipalIdSchema>;
export type HumanPrincipal = z.infer<typeof HumanPrincipalSchema>;
export type AgentPrincipal = z.infer<typeof AgentPrincipalSchema>;
export type SystemPrincipal = z.infer<typeof SystemPrincipalSchema>;
export type Principal = z.infer<typeof PrincipalSchema>;

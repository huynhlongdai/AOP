import * as z from "zod";

import {
  AgentIdSchema,
  GoalIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  RoleIdSchema,
} from "./ids.js";
import { PrincipalSchema } from "./principal.js";

const CapabilityTokenSchema = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[a-z][a-z0-9_.:-]+$/);

const UniqueCapabilityListSchema = z.array(CapabilityTokenSchema).max(256).superRefine((items, ctx) => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate capability: ${item}`,
      });
    }
    seen.add(item);
  }
});

export const OrganizationStatusSchema = z.enum(["active", "paused", "closed"]);
export const OrganizationTypeSchema = z.enum(["company", "organization"]);
export const AutonomyLevelSchema = z.enum([
  "human_managed",
  "assistant_managed",
  "ceo_autonomous",
  "board_managed",
]);

export const OrganizationSchema = z
  .object({
    id: OrganizationIdSchema,
    name: z.string().trim().min(1).max(120),
    type: OrganizationTypeSchema,
    status: OrganizationStatusSchema,
    mission: z.string().trim().max(2_000).optional(),
    owner: PrincipalSchema,
    rootGoalId: GoalIdSchema.optional(),
    autonomyLevel: AutonomyLevelSchema,
    revision: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const AgentEmploymentStatusSchema = z.enum(["active", "suspended", "left"]);

export const AgentSchema = z
  .object({
    id: AgentIdSchema,
    name: z.string().trim().min(1).max(120),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    description: z.string().trim().max(2_000).optional(),
    capabilities: UniqueCapabilityListSchema,
    runtime: z
      .object({
        adapter: CapabilityTokenSchema,
        provider: z.string().trim().min(1).max(80).optional(),
        modelPolicy: z.string().trim().min(1).max(120).optional(),
      })
      .strict(),
    revision: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const OrganizationMembershipSchema = z
  .object({
    id: MembershipIdSchema,
    organizationId: OrganizationIdSchema,
    agentId: AgentIdSchema,
    status: AgentEmploymentStatusSchema,
    joinedAt: z.iso.datetime({ offset: true }),
    leftAt: z.iso.datetime({ offset: true }).optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((membership, ctx) => {
    if (membership.status === "left" && membership.leftAt === undefined) {
      ctx.addIssue({ code: "custom", path: ["leftAt"], message: "leftAt is required when status is left" });
    }
    if (membership.status !== "left" && membership.leftAt !== undefined) {
      ctx.addIssue({ code: "custom", path: ["leftAt"], message: "leftAt is only valid when status is left" });
    }
  });

export const RoleSchema = z
  .object({
    id: RoleIdSchema,
    organizationId: OrganizationIdSchema,
    name: z.string().trim().min(1).max(120),
    purpose: z.string().trim().min(1).max(1_000),
    reportsToRoleId: RoleIdSchema.optional(),
    responsibilities: z.array(z.string().trim().min(1).max(240)).max(64),
    authority: z
      .object({
        allowedCapabilities: UniqueCapabilityListSchema,
        approvalRequiredCapabilities: UniqueCapabilityListSchema,
        deniedCapabilities: UniqueCapabilityListSchema,
      })
      .strict(),
    revision: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const RoleAssignmentSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    agentId: AgentIdSchema,
    roleId: RoleIdSchema,
    managerAgentId: AgentIdSchema.optional(),
    activeFrom: z.iso.datetime({ offset: true }),
    activeUntil: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type OrganizationStatus = z.infer<typeof OrganizationStatusSchema>;
export type OrganizationType = z.infer<typeof OrganizationTypeSchema>;
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type AgentEmploymentStatus = z.infer<typeof AgentEmploymentStatusSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;

import * as z from "zod";

import {
  AgentIdSchema,
  ArtifactIdSchema,
  ArtifactVersionIdSchema,
  GoalIdSchema,
  LeaseIdSchema,
  OrganizationIdSchema,
  TaskIdSchema,
  TaskRunIdSchema,
} from "./ids.js";
import { PrincipalSchema } from "./principal.js";

const CapabilityTokenSchema = z.string().min(2).max(128).regex(/^[a-z][a-z0-9_.:-]+$/);
const TimestampSchema = z.iso.datetime({ offset: true });

export const PrioritySchema = z.enum(["critical", "high", "medium", "low"]);
export const GoalStatusSchema = z.enum(["planned", "active", "blocked", "completed", "cancelled"]);

export const GoalSchema = z
  .object({
    id: GoalIdSchema,
    organizationId: OrganizationIdSchema,
    parentGoalId: GoalIdSchema.optional(),
    title: z.string().trim().min(1).max(180),
    objective: z.string().trim().min(1).max(4_000),
    owner: PrincipalSchema,
    successCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(64),
    priority: PrioritySchema,
    status: GoalStatusSchema,
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((goal, ctx) => {
    if (goal.status === "completed" && goal.completedAt === undefined) {
      ctx.addIssue({ code: "custom", path: ["completedAt"], message: "completedAt is required for completed goals" });
    }
    if (goal.status !== "completed" && goal.completedAt !== undefined) {
      ctx.addIssue({ code: "custom", path: ["completedAt"], message: "completedAt is only valid for completed goals" });
    }
  });

export const TaskStateSchema = z.enum([
  "proposed",
  "ready",
  "leased",
  "running",
  "blocked",
  "review",
  "completed",
  "failed",
  "cancelled",
  "rejected",
]);

export const TaskBlockReasonSchema = z.enum([
  "dependency",
  "human_input",
  "external_system",
  "resource",
  "decision",
  "capability_gap",
]);

export const TaskBlockSchema = z
  .object({
    reason: TaskBlockReasonSchema,
    detail: z.string().trim().min(1).max(1_000),
    since: TimestampSchema,
  })
  .strict();

export const TaskArtifactInputSchema = z
  .object({
    artifactId: ArtifactIdSchema,
    versionId: ArtifactVersionIdSchema,
    required: z.boolean(),
  })
  .strict();

export const TaskDeliverableSchema = z
  .object({
    type: CapabilityTokenSchema,
    description: z.string().trim().min(1).max(500),
    required: z.boolean(),
  })
  .strict();

export const TaskBudgetSchema = z
  .object({
    maxComputeCredits: z.number().nonnegative().optional(),
    maxToolCalls: z.number().int().nonnegative().optional(),
    maxTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const TaskSchema = z
  .object({
    id: TaskIdSchema,
    organizationId: OrganizationIdSchema,
    goalId: GoalIdSchema,
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(4_000),
    createdBy: PrincipalSchema,
    ownerAgentId: AgentIdSchema.optional(),
    reviewerAgentId: AgentIdSchema.optional(),
    priority: PrioritySchema,
    state: TaskStateSchema,
    scope: z
      .object({
        includes: z.array(z.string().trim().min(1).max(500)).max(64),
        excludes: z.array(z.string().trim().min(1).max(500)).max(64),
      })
      .strict(),
    inputs: z.array(TaskArtifactInputSchema).max(64),
    deliverables: z.array(TaskDeliverableSchema).min(1).max(64),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(64),
    requiredCapabilities: z.array(CapabilityTokenSchema).max(128),
    constraints: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    budget: TaskBudgetSchema,
    block: TaskBlockSchema.optional(),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((task, ctx) => {
    if (task.state === "blocked" && task.block === undefined) {
      ctx.addIssue({ code: "custom", path: ["block"], message: "blocked tasks require a structured block reason" });
    }
    if (task.state !== "blocked" && task.block !== undefined) {
      ctx.addIssue({ code: "custom", path: ["block"], message: "block is only valid when task state is blocked" });
    }
    if (task.state === "completed" && task.completedAt === undefined) {
      ctx.addIssue({ code: "custom", path: ["completedAt"], message: "completedAt is required for completed tasks" });
    }
    if (task.state !== "completed" && task.completedAt !== undefined) {
      ctx.addIssue({ code: "custom", path: ["completedAt"], message: "completedAt is only valid for completed tasks" });
    }
  });

export const TaskRunStatusSchema = z.enum([
  "created",
  "preparing",
  "running",
  "paused",
  "succeeded",
  "failed",
  "lost",
  "cancelled",
]);

export const TaskRunSchema = z
  .object({
    id: TaskRunIdSchema,
    organizationId: OrganizationIdSchema,
    taskId: TaskIdSchema,
    agentId: AgentIdSchema,
    attempt: z.number().int().positive(),
    status: TaskRunStatusSchema,
    runtimeType: CapabilityTokenSchema,
    runtimeId: z.string().trim().min(1).max(240).optional(),
    workspaceId: z.string().trim().min(1).max(240),
    snapshotId: z.string().trim().min(1).max(240).optional(),
    startedAt: TimestampSchema.optional(),
    heartbeatAt: TimestampSchema.optional(),
    finishedAt: TimestampSchema.optional(),
    failureReason: z.string().trim().min(1).max(2_000).optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const LeaseStatusSchema = z.enum(["active", "expired", "released"]);

export const LeaseSchema = z
  .object({
    id: LeaseIdSchema,
    organizationId: OrganizationIdSchema,
    taskId: TaskIdSchema,
    runId: TaskRunIdSchema,
    agentId: AgentIdSchema,
    status: LeaseStatusSchema,
    attempt: z.number().int().positive(),
    acquiredAt: TimestampSchema,
    expiresAt: TimestampSchema,
    heartbeatIntervalSeconds: z.number().int().positive().max(3_600),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((lease, ctx) => {
    if (Date.parse(lease.expiresAt) <= Date.parse(lease.acquiredAt)) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "expiresAt must be later than acquiredAt" });
    }
  });

export type Priority = z.infer<typeof PrioritySchema>;
export type GoalStatus = z.infer<typeof GoalStatusSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export type TaskBlockReason = z.infer<typeof TaskBlockReasonSchema>;
export type TaskBlock = z.infer<typeof TaskBlockSchema>;
export type TaskArtifactInput = z.infer<typeof TaskArtifactInputSchema>;
export type TaskDeliverable = z.infer<typeof TaskDeliverableSchema>;
export type TaskBudget = z.infer<typeof TaskBudgetSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskRunStatus = z.infer<typeof TaskRunStatusSchema>;
export type TaskRun = z.infer<typeof TaskRunSchema>;
export type LeaseStatus = z.infer<typeof LeaseStatusSchema>;
export type Lease = z.infer<typeof LeaseSchema>;

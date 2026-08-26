import * as z from "zod";

import { AgentIdSchema, ArtifactVersionIdSchema, TaskIdSchema } from "./ids.js";
import { TaskDependencyTypeSchema } from "./dependency.js";
import { PrioritySchema, TaskBudgetSchema, TaskDeliverableSchema } from "./work.js";

const CapabilityTokenSchema = z.string().min(2).max(128).regex(/^[a-z][a-z0-9_.:-]+$/);

const TaskCreateArtifactInputSchema = z
  .object({
    artifactVersionId: ArtifactVersionIdSchema,
    required: z.boolean(),
  })
  .strict();

const TaskCreateDependencyInputSchema = z
  .object({
    taskId: TaskIdSchema,
    type: TaskDependencyTypeSchema,
  })
  .strict();

export const TaskCreatePayloadSchema = z
  .object({
    taskId: TaskIdSchema,
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(4_000),
    ownerAgentId: AgentIdSchema,
    reviewerAgentId: AgentIdSchema,
    priority: PrioritySchema,
    scope: z
      .object({
        includes: z.array(z.string().trim().min(1).max(500)).max(64),
        excludes: z.array(z.string().trim().min(1).max(500)).max(64),
      })
      .strict(),
    inputs: z.array(TaskCreateArtifactInputSchema).max(64).default([]),
    deliverables: z.array(TaskDeliverableSchema).min(1).max(64),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(64),
    requiredCapabilities: z.array(CapabilityTokenSchema).max(128).default([]),
    constraints: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    budget: TaskBudgetSchema.default({}),
    dependencies: z.array(TaskCreateDependencyInputSchema).max(128).default([]),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.ownerAgentId === payload.reviewerAgentId) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewerAgentId"],
        message: "Task owner and reviewer must be different Agents",
      });
    }

    const artifactVersionIds = payload.inputs.map((input) => input.artifactVersionId);
    if (new Set(artifactVersionIds).size !== artifactVersionIds.length) {
      ctx.addIssue({ code: "custom", path: ["inputs"], message: "Task Artifact inputs cannot contain duplicates" });
    }

    const dependencyIds = payload.dependencies.map((dependency) => dependency.taskId);
    if (new Set(dependencyIds).size !== dependencyIds.length) {
      ctx.addIssue({ code: "custom", path: ["dependencies"], message: "Task dependencies cannot contain duplicates" });
    }
    if (dependencyIds.includes(payload.taskId)) {
      ctx.addIssue({
        code: "custom",
        path: ["dependencies"],
        message: "New Task cannot depend on itself",
      });
    }
  });

export type TaskCreatePayload = z.infer<typeof TaskCreatePayloadSchema>;
export type TaskCreateArtifactInput = z.infer<typeof TaskCreateArtifactInputSchema>;
export type TaskCreateDependencyInput = z.infer<typeof TaskCreateDependencyInputSchema>;

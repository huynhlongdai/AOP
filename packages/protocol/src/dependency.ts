import * as z from "zod";

import { OrganizationIdSchema, TaskIdSchema } from "./ids.js";

export const TaskDependencyTypeSchema = z.enum(["hard", "soft", "informational"]);

export const TaskDependencySchema = z
  .object({
    organizationId: OrganizationIdSchema,
    taskId: TaskIdSchema,
    dependsOnTaskId: TaskIdSchema,
    type: TaskDependencyTypeSchema,
  })
  .strict()
  .superRefine((dependency, ctx) => {
    if (dependency.taskId === dependency.dependsOnTaskId) {
      ctx.addIssue({
        code: "custom",
        path: ["dependsOnTaskId"],
        message: "A task cannot depend on itself",
      });
    }
  });

export type TaskDependencyType = z.infer<typeof TaskDependencyTypeSchema>;
export type TaskDependency = z.infer<typeof TaskDependencySchema>;

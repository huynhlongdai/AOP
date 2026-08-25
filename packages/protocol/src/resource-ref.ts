import * as z from "zod";

import {
  AgentIdSchema,
  ApprovalRequestIdSchema,
  ArtifactIdSchema,
  ArtifactVersionIdSchema,
  CommandIdSchema,
  ContextManifestIdSchema,
  DecisionIdSchema,
  EventIdSchema,
  GoalIdSchema,
  LeaseIdSchema,
  OrganizationIdSchema,
  PermissionIdSchema,
  ReviewIdSchema,
  RoleIdSchema,
  TaskIdSchema,
  TaskRunIdSchema,
} from "./ids.js";

const ref = <TType extends string, TSchema extends z.ZodType>(type: TType, id: TSchema) =>
  z.object({ type: z.literal(type), id }).strict();

export const ResourceRefSchema = z.discriminatedUnion("type", [
  ref("organization", OrganizationIdSchema),
  ref("agent", AgentIdSchema),
  ref("role", RoleIdSchema),
  ref("goal", GoalIdSchema),
  ref("task", TaskIdSchema),
  ref("task_run", TaskRunIdSchema),
  ref("lease", LeaseIdSchema),
  ref("artifact", ArtifactIdSchema),
  ref("artifact_version", ArtifactVersionIdSchema),
  ref("decision", DecisionIdSchema),
  ref("review", ReviewIdSchema),
  ref("permission", PermissionIdSchema),
  ref("approval", ApprovalRequestIdSchema),
  ref("event", EventIdSchema),
  ref("command", CommandIdSchema),
  ref("context_manifest", ContextManifestIdSchema),
]);

export type ResourceRef = z.infer<typeof ResourceRefSchema>;

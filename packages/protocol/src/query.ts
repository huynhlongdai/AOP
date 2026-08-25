import * as z from "zod";

import { OrganizationIdSchema, TaskIdSchema } from "./ids.js";
import {
  AgentSchema,
  OrganizationMembershipSchema,
  OrganizationSchema,
  RoleAssignmentSchema,
  RoleSchema,
} from "./organization.js";
import { EventEnvelopeSchema } from "./envelopes.js";
import { TaskDependencySchema } from "./dependency.js";
import { ApprovalRequestSchema, ArtifactSchema, ArtifactVersionSchema, DecisionSchema, ReviewSchema } from "./truth.js";
import { GoalSchema, LeaseSchema, TaskRunSchema, TaskSchema } from "./work.js";

const TimestampSchema = z.iso.datetime({ offset: true });

export const OrganizationSnapshotSchema = z
  .object({
    organization: OrganizationSchema,
    agents: z.array(AgentSchema),
    memberships: z.array(OrganizationMembershipSchema),
    roles: z.array(RoleSchema),
    roleAssignments: z.array(RoleAssignmentSchema),
    goals: z.array(GoalSchema),
    tasks: z.array(TaskSchema),
    pendingApprovals: z.array(ApprovalRequestSchema),
    latestEventSequence: z.number().int().nonnegative(),
    generatedAt: TimestampSchema,
  })
  .strict();

export const TaskOutputRefSchema = z
  .object({
    artifactVersionId: z.string().min(1),
    deliverableType: z.string().min(1).max(128),
  })
  .strict();

export const TaskDetailQuerySchema = z
  .object({
    task: TaskSchema,
    dependencies: z.array(TaskDependencySchema),
    runs: z.array(TaskRunSchema),
    leases: z.array(LeaseSchema),
    reviews: z.array(ReviewSchema),
    outputs: z.array(TaskOutputRefSchema),
  })
  .strict();

export const ArtifactVersionsQuerySchema = z
  .object({
    artifact: ArtifactSchema,
    versions: z.array(ArtifactVersionSchema),
  })
  .strict();

export const EventPageSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    afterSequence: z.number().int().nonnegative(),
    events: z.array(EventEnvelopeSchema),
    nextAfterSequence: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();

export const TaskLookupSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    taskId: TaskIdSchema,
  })
  .strict();

export const DecisionListQuerySchema = z.array(DecisionSchema);
export const ApprovalListQuerySchema = z.array(ApprovalRequestSchema);
export const GoalListQuerySchema = z.array(GoalSchema);
export const TaskListQuerySchema = z.array(TaskSchema);

export type OrganizationSnapshot = z.infer<typeof OrganizationSnapshotSchema>;
export type TaskDetailQuery = z.infer<typeof TaskDetailQuerySchema>;
export type ArtifactVersionsQuery = z.infer<typeof ArtifactVersionsQuerySchema>;
export type EventPage = z.infer<typeof EventPageSchema>;

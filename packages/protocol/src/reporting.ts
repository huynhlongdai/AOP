import * as z from "zod";

import { DecisionIdSchema, OrganizationIdSchema, ReviewIdSchema, TaskIdSchema } from "./ids.js";

const TimestampSchema = z.iso.datetime({ offset: true });
const CountSchema = z.number().int().nonnegative();

export const TaskStateCountsSchema = z
  .object({
    proposed: CountSchema,
    ready: CountSchema,
    leased: CountSchema,
    running: CountSchema,
    blocked: CountSchema,
    review: CountSchema,
    completed: CountSchema,
    failed: CountSchema,
    cancelled: CountSchema,
    rejected: CountSchema,
  })
  .strict();

export const TaskRunStatusCountsSchema = z
  .object({
    created: CountSchema,
    preparing: CountSchema,
    running: CountSchema,
    paused: CountSchema,
    succeeded: CountSchema,
    failed: CountSchema,
    lost: CountSchema,
    cancelled: CountSchema,
  })
  .strict();

export const LeaseStatusCountsSchema = z
  .object({
    active: CountSchema,
    expired: CountSchema,
    released: CountSchema,
  })
  .strict();

export const DecisionStatusCountsSchema = z
  .object({
    proposed: CountSchema,
    discussion: CountSchema,
    approvalPending: CountSchema,
    active: CountSchema,
    rejected: CountSchema,
    superseded: CountSchema,
  })
  .strict();

export const ReviewResultCountsSchema = z
  .object({
    pending: CountSchema,
    pass: CountSchema,
    rework: CountSchema,
    fail: CountSchema,
  })
  .strict();

export const ArtifactReportCountsSchema = z
  .object({
    total: CountSchema,
    withCurrentApprovedVersion: CountSchema,
    staleConsumerLinks: CountSchema,
  })
  .strict();

export const VerifiedProgressSchema = z
  .object({
    eligibleTasks: CountSchema,
    completedTasks: CountSchema,
    ratio: z.number().min(0).max(1),
  })
  .strict();

export const OrganizationReportBlockersSchema = z
  .object({
    blockedTaskIds: z.array(TaskIdSchema),
    staleInputTaskIds: z.array(TaskIdSchema),
    pendingDecisionIds: z.array(DecisionIdSchema),
    reworkReviewIds: z.array(ReviewIdSchema),
  })
  .strict();

export const OrganizationReportSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    generatedAt: TimestampSchema,
    latestEventSequence: CountSchema,
    tasks: TaskStateCountsSchema,
    taskRuns: TaskRunStatusCountsSchema,
    leases: LeaseStatusCountsSchema,
    decisions: DecisionStatusCountsSchema,
    reviews: ReviewResultCountsSchema,
    artifacts: ArtifactReportCountsSchema,
    verifiedProgress: VerifiedProgressSchema,
    blockers: OrganizationReportBlockersSchema,
  })
  .strict();

export type TaskStateCounts = z.infer<typeof TaskStateCountsSchema>;
export type TaskRunStatusCounts = z.infer<typeof TaskRunStatusCountsSchema>;
export type LeaseStatusCounts = z.infer<typeof LeaseStatusCountsSchema>;
export type DecisionStatusCounts = z.infer<typeof DecisionStatusCountsSchema>;
export type ReviewResultCounts = z.infer<typeof ReviewResultCountsSchema>;
export type ArtifactReportCounts = z.infer<typeof ArtifactReportCountsSchema>;
export type VerifiedProgress = z.infer<typeof VerifiedProgressSchema>;
export type OrganizationReportBlockers = z.infer<typeof OrganizationReportBlockersSchema>;
export type OrganizationReport = z.infer<typeof OrganizationReportSchema>;

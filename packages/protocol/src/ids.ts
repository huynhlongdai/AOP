import * as z from "zod";

const ULID_PATTERN = "[0-9A-HJKMNP-TV-Z]{26}";

function prefixedId(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}_${ULID_PATTERN}$`), {
    error: `Expected ${prefix}_ followed by a 26-character Crockford ULID`,
  });
}

export const UserIdSchema = prefixedId("usr");
export const OrganizationIdSchema = prefixedId("org");
export const AgentIdSchema = prefixedId("agt");
export const MembershipIdSchema = prefixedId("mem");
export const RoleIdSchema = prefixedId("rol");
export const GoalIdSchema = prefixedId("gol");
export const TaskIdSchema = prefixedId("tsk");
export const TaskRunIdSchema = prefixedId("run");
export const LeaseIdSchema = prefixedId("lea");
export const ArtifactIdSchema = prefixedId("art");
export const ArtifactVersionIdSchema = prefixedId("arv");
export const DecisionIdSchema = prefixedId("dec");
export const ReviewIdSchema = prefixedId("rev");
export const PermissionIdSchema = prefixedId("per");
export const ApprovalRequestIdSchema = prefixedId("apr");
export const EventIdSchema = prefixedId("evt");
export const CommandIdSchema = prefixedId("cmd");
export const ContextManifestIdSchema = prefixedId("ctx");

export type UserId = z.infer<typeof UserIdSchema>;
export type OrganizationId = z.infer<typeof OrganizationIdSchema>;
export type AgentId = z.infer<typeof AgentIdSchema>;
export type MembershipId = z.infer<typeof MembershipIdSchema>;
export type RoleId = z.infer<typeof RoleIdSchema>;
export type GoalId = z.infer<typeof GoalIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type TaskRunId = z.infer<typeof TaskRunIdSchema>;
export type LeaseId = z.infer<typeof LeaseIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type ArtifactVersionId = z.infer<typeof ArtifactVersionIdSchema>;
export type DecisionId = z.infer<typeof DecisionIdSchema>;
export type ReviewId = z.infer<typeof ReviewIdSchema>;
export type PermissionId = z.infer<typeof PermissionIdSchema>;
export type ApprovalRequestId = z.infer<typeof ApprovalRequestIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type ContextManifestId = z.infer<typeof ContextManifestIdSchema>;

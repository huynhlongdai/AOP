import {
  AgentSchema,
  ApprovalRequestSchema,
  ArtifactSchema,
  ArtifactVersionSchema,
  DecisionSchema,
  EventEnvelopeSchema,
  GoalSchema,
  LeaseSchema,
  OrganizationMembershipSchema,
  OrganizationSchema,
  ReviewSchema,
  RoleAssignmentSchema,
  RoleSchema,
  TaskDependencySchema,
  TaskRunSchema,
  TaskSchema,
  type ArtifactVersionId,
  type ResourceRef,
  type TaskArtifactInput,
} from "@aop/protocol";

export type QueryRow = Readonly<Record<string, unknown>>;

function requiredString(row: QueryRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new TypeError(`Expected ${key} to be a string`);
  return value;
}

function optionalString(row: QueryRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`Expected ${key} to be a string or null`);
  return value;
}

function requiredNumber(row: QueryRow, key: string): number {
  const value = row[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new TypeError(`Expected ${key} to be numeric`);
  return parsed;
}

function requiredJson(row: QueryRow, key: string): unknown {
  const value = row[key];
  if (typeof value === "string") return JSON.parse(value) as unknown;
  if (value === null || value === undefined) throw new TypeError(`Expected ${key} to contain JSON`);
  return value;
}

function timestampValue(value: unknown, key: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  throw new TypeError(`Expected ${key} to be a timestamp`);
}

function requiredTimestamp(row: QueryRow, key: string): string {
  return timestampValue(row[key], key);
}

function optionalTimestamp(row: QueryRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return timestampValue(value, key);
}

function principal(type: unknown, id: unknown): unknown {
  return { type, id };
}

function optionalResource(type: unknown, id: unknown): unknown | undefined {
  if (type === null || type === undefined || id === null || id === undefined) return undefined;
  return { type, id };
}

export function mapOrganization(row: QueryRow) {
  const mission = optionalString(row, "mission");
  const rootGoalId = optionalString(row, "root_goal_id");
  return OrganizationSchema.parse({
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    type: requiredString(row, "type"),
    status: requiredString(row, "status"),
    owner: principal(row.owner_type, row.owner_id),
    autonomyLevel: requiredString(row, "autonomy_level"),
    revision: requiredNumber(row, "revision"),
    createdAt: requiredTimestamp(row, "created_at"),
    updatedAt: requiredTimestamp(row, "updated_at"),
    ...(mission === undefined ? {} : { mission }),
    ...(rootGoalId === undefined ? {} : { rootGoalId }),
  });
}

export function mapAgent(row: QueryRow) {
  const description = optionalString(row, "description");
  return AgentSchema.parse({
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    version: requiredString(row, "version"),
    capabilities: requiredJson(row, "capabilities"),
    runtime: requiredJson(row, "runtime"),
    revision: requiredNumber(row, "revision"),
    createdAt: requiredTimestamp(row, "created_at"),
    updatedAt: requiredTimestamp(row, "updated_at"),
    ...(description === undefined ? {} : { description }),
  });
}

export function mapMembership(row: QueryRow) {
  const leftAt = optionalTimestamp(row, "left_at");
  return OrganizationMembershipSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    agentId: requiredString(row, "agent_id"),
    status: requiredString(row, "status"),
    joinedAt: requiredTimestamp(row, "joined_at"),
    revision: requiredNumber(row, "revision"),
    ...(leftAt === undefined ? {} : { leftAt }),
  });
}

export function mapRole(row: QueryRow) {
  const reportsToRoleId = optionalString(row, "reports_to_role_id");
  return RoleSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    name: requiredString(row, "name"),
    purpose: requiredString(row, "purpose"),
    responsibilities: requiredJson(row, "responsibilities"),
    authority: requiredJson(row, "authority"),
    revision: requiredNumber(row, "revision"),
    createdAt: requiredTimestamp(row, "created_at"),
    updatedAt: requiredTimestamp(row, "updated_at"),
    ...(reportsToRoleId === undefined ? {} : { reportsToRoleId }),
  });
}

export function mapRoleAssignment(row: QueryRow) {
  const managerAgentId = optionalString(row, "manager_agent_id");
  const activeUntil = optionalTimestamp(row, "active_until");
  return RoleAssignmentSchema.parse({
    organizationId: requiredString(row, "organization_id"),
    agentId: requiredString(row, "agent_id"),
    roleId: requiredString(row, "role_id"),
    activeFrom: requiredTimestamp(row, "active_from"),
    ...(managerAgentId === undefined ? {} : { managerAgentId }),
    ...(activeUntil === undefined ? {} : { activeUntil }),
  });
}

export function mapGoal(row: QueryRow) {
  const parentGoalId = optionalString(row, "parent_goal_id");
  const completedAt = optionalTimestamp(row, "completed_at");
  return GoalSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    title: requiredString(row, "title"),
    objective: requiredString(row, "objective"),
    owner: principal(row.owner_type, row.owner_id),
    successCriteria: requiredJson(row, "success_criteria"),
    priority: requiredString(row, "priority"),
    status: requiredString(row, "status"),
    revision: requiredNumber(row, "revision"),
    createdAt: requiredTimestamp(row, "created_at"),
    updatedAt: requiredTimestamp(row, "updated_at"),
    ...(parentGoalId === undefined ? {} : { parentGoalId }),
    ...(completedAt === undefined ? {} : { completedAt }),
  });
}

export function mapTask(row: QueryRow, inputs: readonly TaskArtifactInput[]) {
  const ownerAgentId = optionalString(row, "owner_agent_id");
  const reviewerAgentId = optionalString(row, "reviewer_agent_id");
  const completedAt = optionalTimestamp(row, "completed_at");
  const blockReason = optionalString(row, "block_reason");
  const blockDetail = optionalString(row, "block_detail");
  const blockedSince = optionalTimestamp(row, "blocked_since");
  const block =
    blockReason === undefined || blockDetail === undefined || blockedSince === undefined
      ? undefined
      : { reason: blockReason, detail: blockDetail, since: blockedSince };

  return TaskSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    goalId: requiredString(row, "goal_id"),
    title: requiredString(row, "title"),
    objective: requiredString(row, "objective"),
    createdBy: principal(row.created_by_type, row.created_by_id),
    priority: requiredString(row, "priority"),
    state: requiredString(row, "state"),
    scope: requiredJson(row, "scope"),
    inputs: [...inputs],
    deliverables: requiredJson(row, "deliverables"),
    acceptanceCriteria: requiredJson(row, "acceptance_criteria"),
    requiredCapabilities: requiredJson(row, "required_capabilities"),
    constraints: requiredJson(row, "constraints"),
    budget: requiredJson(row, "budget"),
    revision: requiredNumber(row, "revision"),
    createdAt: requiredTimestamp(row, "created_at"),
    updatedAt: requiredTimestamp(row, "updated_at"),
    ...(ownerAgentId === undefined ? {} : { ownerAgentId }),
    ...(reviewerAgentId === undefined ? {} : { reviewerAgentId }),
    ...(block === undefined ? {} : { block }),
    ...(completedAt === undefined ? {} : { completedAt }),
  });
}

export function mapTaskRun(row: QueryRow) {
  const runtimeId = optionalString(row, "runtime_id");
  const snapshotId = optionalString(row, "snapshot_id");
  const startedAt = optionalTimestamp(row, "started_at");
  const heartbeatAt = optionalTimestamp(row, "heartbeat_at");
  const finishedAt = optionalTimestamp(row, "finished_at");
  const failureReason = optionalString(row, "failure_reason");
  return TaskRunSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    taskId: requiredString(row, "task_id"),
    agentId: requiredString(row, "agent_id"),
    attempt: requiredNumber(row, "attempt"),
    status: requiredString(row, "status"),
    runtimeType: requiredString(row, "runtime_type"),
    workspaceId: requiredString(row, "workspace_id"),
    revision: requiredNumber(row, "revision"),
    ...(runtimeId === undefined ? {} : { runtimeId }),
    ...(snapshotId === undefined ? {} : { snapshotId }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(failureReason === undefined ? {} : { failureReason }),
  });
}

export function mapLease(row: QueryRow) {
  return LeaseSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    taskId: requiredString(row, "task_id"),
    runId: requiredString(row, "run_id"),
    agentId: requiredString(row, "agent_id"),
    status: requiredString(row, "status"),
    attempt: requiredNumber(row, "attempt"),
    acquiredAt: requiredTimestamp(row, "acquired_at"),
    expiresAt: requiredTimestamp(row, "expires_at"),
    heartbeatIntervalSeconds: requiredNumber(row, "heartbeat_interval_seconds"),
    revision: requiredNumber(row, "revision"),
  });
}

export function mapTaskDependency(row: QueryRow) {
  return TaskDependencySchema.parse({
    organizationId: requiredString(row, "organization_id"),
    taskId: requiredString(row, "task_id"),
    dependsOnTaskId: requiredString(row, "depends_on_task_id"),
    type: requiredString(row, "dependency_type"),
  });
}

export function mapReview(row: QueryRow) {
  const completedAt = optionalTimestamp(row, "completed_at");
  return ReviewSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    subject: { type: row.subject_type, id: row.subject_id },
    reviewer: principal(row.reviewer_type, row.reviewer_id),
    criteria: requiredJson(row, "criteria"),
    evidence: requiredJson(row, "evidence"),
    result: requiredString(row, "result"),
    findings: requiredJson(row, "findings"),
    createdAt: requiredTimestamp(row, "created_at"),
    revision: requiredNumber(row, "revision"),
    ...(completedAt === undefined ? {} : { completedAt }),
  });
}

export function mapApproval(row: QueryRow) {
  const target = optionalResource(row.target_type, row.target_id);
  const estimatedCostCredits =
    row.estimated_cost_credits === null || row.estimated_cost_credits === undefined
      ? undefined
      : requiredNumber(row, "estimated_cost_credits");
  const decidedBy = optionalResource(row.decided_by_type, row.decided_by_id);
  const decidedAt = optionalTimestamp(row, "decided_at");
  const decisionNote = optionalString(row, "decision_note");
  const expiresAt = optionalTimestamp(row, "expires_at");

  return ApprovalRequestSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    commandId: requiredString(row, "command_id"),
    commandType: requiredString(row, "command_type"),
    requestedBy: principal(row.requested_by_type, row.requested_by_id),
    policyRule: requiredString(row, "policy_rule"),
    requiredAuthority: requiredString(row, "required_authority"),
    risk: requiredString(row, "risk"),
    evidence: requiredJson(row, "evidence"),
    impactSummary: requiredString(row, "impact_summary"),
    status: requiredString(row, "status"),
    revision: requiredNumber(row, "revision"),
    createdAt: requiredTimestamp(row, "created_at"),
    ...(target === undefined ? {} : { target }),
    ...(estimatedCostCredits === undefined ? {} : { estimatedCostCredits }),
    ...(decidedBy === undefined ? {} : { decidedBy }),
    ...(decidedAt === undefined ? {} : { decidedAt }),
    ...(decisionNote === undefined ? {} : { decisionNote }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });
}

export function mapDecision(row: QueryRow, affectedResources: readonly ResourceRef[]) {
  const selectedOptionId = optionalString(row, "selected_option_id");
  const rationale = optionalString(row, "rationale");
  const approvedBy = optionalResource(row.approved_by_type, row.approved_by_id);
  const effectiveAt = optionalTimestamp(row, "effective_at");
  const supersedesDecisionId = optionalString(row, "supersedes_decision_id");

  return DecisionSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    scope: requiredString(row, "scope"),
    question: requiredString(row, "question"),
    options: requiredJson(row, "options"),
    proposedBy: principal(row.proposed_by_type, row.proposed_by_id),
    authorityCapability: requiredString(row, "authority_capability"),
    status: requiredString(row, "status"),
    affectedResources: [...affectedResources],
    revision: requiredNumber(row, "revision"),
    createdAt: requiredTimestamp(row, "created_at"),
    updatedAt: requiredTimestamp(row, "updated_at"),
    ...(selectedOptionId === undefined ? {} : { selectedOptionId }),
    ...(rationale === undefined ? {} : { rationale }),
    ...(approvedBy === undefined ? {} : { approvedBy }),
    ...(effectiveAt === undefined ? {} : { effectiveAt }),
    ...(supersedesDecisionId === undefined ? {} : { supersedesDecisionId }),
  });
}

export function mapArtifact(row: QueryRow) {
  const currentApprovedVersionId = optionalString(row, "current_approved_version_id");
  return ArtifactSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    type: requiredString(row, "type"),
    title: requiredString(row, "title"),
    revision: requiredNumber(row, "revision"),
    createdAt: requiredTimestamp(row, "created_at"),
    updatedAt: requiredTimestamp(row, "updated_at"),
    ...(currentApprovedVersionId === undefined ? {} : { currentApprovedVersionId }),
  });
}

export function mapArtifactVersion(row: QueryRow, derivedFromVersionIds: readonly ArtifactVersionId[]) {
  const producedByTaskId = optionalString(row, "produced_by_task_id");
  const contentSchema = optionalString(row, "content_schema");
  const supersedesVersionId = optionalString(row, "supersedes_version_id");
  const approvedBy = optionalResource(row.approved_by_type, row.approved_by_id);
  const approvedAt = optionalTimestamp(row, "approved_at");

  return ArtifactVersionSchema.parse({
    id: requiredString(row, "id"),
    organizationId: requiredString(row, "organization_id"),
    artifactId: requiredString(row, "artifact_id"),
    version: requiredNumber(row, "version"),
    status: requiredString(row, "status"),
    createdBy: principal(row.created_by_type, row.created_by_id),
    content: {
      uri: requiredString(row, "content_uri"),
      mimeType: requiredString(row, "mime_type"),
      checksum: requiredString(row, "checksum"),
      sizeBytes: requiredNumber(row, "size_bytes"),
      ...(contentSchema === undefined ? {} : { schema: contentSchema }),
    },
    derivedFromVersionIds: [...derivedFromVersionIds],
    createdAt: requiredTimestamp(row, "created_at"),
    ...(producedByTaskId === undefined ? {} : { producedByTaskId }),
    ...(supersedesVersionId === undefined ? {} : { supersedesVersionId }),
    ...(approvedBy === undefined ? {} : { approvedBy }),
    ...(approvedAt === undefined ? {} : { approvedAt }),
  });
}

export function mapEvent(row: QueryRow) {
  const causationId = optionalString(row, "causation_id");
  return EventEnvelopeSchema.parse({
    schemaVersion: requiredNumber(row, "schema_version"),
    protocolVersion: requiredString(row, "protocol_version"),
    eventId: requiredString(row, "id"),
    type: requiredString(row, "type"),
    organizationId: requiredString(row, "organization_id"),
    organizationSequence: requiredNumber(row, "organization_sequence"),
    aggregate: { type: row.aggregate_type, id: row.aggregate_id },
    aggregateRevision: requiredNumber(row, "aggregate_revision"),
    actor: principal(row.actor_type, row.actor_id),
    correlationId: requiredString(row, "correlation_id"),
    payload: requiredJson(row, "payload"),
    occurredAt: requiredTimestamp(row, "occurred_at"),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

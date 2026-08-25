import type { Pool, PoolClient } from "pg";

import {
  ApprovalListQuerySchema,
  ArtifactVersionsQuerySchema,
  DecisionListQuerySchema,
  EventPageSchema,
  GoalListQuerySchema,
  OrganizationSnapshotSchema,
  ResourceRefSchema,
  TaskDetailQuerySchema,
  TaskListQuerySchema,
  TaskOutputRefSchema,
  type ApprovalRequest,
  type ArtifactId,
  type ArtifactVersionId,
  type ArtifactVersionsQuery,
  type Decision,
  type EventPage,
  type Goal,
  type OrganizationId,
  type OrganizationSnapshot,
  type ResourceRef,
  type Task,
  type TaskArtifactInput,
  type TaskDetailQuery,
  type TaskId,
} from "@aop/protocol";

import {
  mapAgent,
  mapApproval,
  mapArtifact,
  mapArtifactVersion,
  mapDecision,
  mapEvent,
  mapGoal,
  mapLease,
  mapMembership,
  mapOrganization,
  mapReview,
  mapRole,
  mapRoleAssignment,
  mapTask,
  mapTaskDependency,
  mapTaskRun,
  type QueryRow,
} from "./query-mappers.js";

export interface OrganizationQueryStore {
  getOrganizationSnapshot(organizationId: OrganizationId): Promise<OrganizationSnapshot | undefined>;
  getTaskDetail(organizationId: OrganizationId, taskId: TaskId): Promise<TaskDetailQuery | undefined>;
  getArtifactVersions(
    organizationId: OrganizationId,
    artifactId: ArtifactId,
  ): Promise<ArtifactVersionsQuery | undefined>;
  listEvents(organizationId: OrganizationId, afterSequence?: number, limit?: number): Promise<EventPage>;
  listDecisions(organizationId: OrganizationId): Promise<readonly Decision[]>;
  listApprovals(organizationId: OrganizationId, status?: ApprovalRequest["status"]): Promise<readonly ApprovalRequest[]>;
  listGoals(organizationId: OrganizationId): Promise<readonly Goal[]>;
  listTasks(organizationId: OrganizationId): Promise<readonly Task[]>;
}

async function rows(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow[]> {
  const result = await client.query<Record<string, unknown>>(text, [...values]);
  return result.rows;
}

async function one(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow | undefined> {
  return (await rows(client, text, values))[0];
}

function taskInputsByTask(rowsToMap: readonly QueryRow[]): ReadonlyMap<string, readonly TaskArtifactInput[]> {
  const result = new Map<string, TaskArtifactInput[]>();
  for (const row of rowsToMap) {
    const taskId = String(row.task_id);
    const current = result.get(taskId) ?? [];
    current.push({
      artifactId: String(row.artifact_id) as TaskArtifactInput["artifactId"],
      versionId: String(row.artifact_version_id) as TaskArtifactInput["versionId"],
      required: Boolean(row.required),
    });
    result.set(taskId, current);
  }
  return result;
}

async function loadTaskInputs(
  client: PoolClient,
  organizationId: OrganizationId,
  taskId?: TaskId,
): Promise<ReadonlyMap<string, readonly TaskArtifactInput[]>> {
  const predicate = taskId === undefined ? "" : " AND tai.task_id = $2";
  const values: readonly unknown[] = taskId === undefined ? [organizationId] : [organizationId, taskId];
  const inputRows = await rows(
    client,
    `SELECT tai.task_id, av.artifact_id, tai.artifact_version_id, tai.required
       FROM aop.task_artifact_inputs tai
       JOIN aop.artifact_versions av
         ON av.organization_id = tai.organization_id
        AND av.id = tai.artifact_version_id
      WHERE tai.organization_id = $1${predicate}
      ORDER BY tai.task_id, tai.created_at, tai.artifact_version_id`,
    values,
  );
  return taskInputsByTask(inputRows);
}

async function loadTasks(
  client: PoolClient,
  organizationId: OrganizationId,
  taskId?: TaskId,
): Promise<readonly Task[]> {
  const predicate = taskId === undefined ? "" : " AND id = $2";
  const values: readonly unknown[] = taskId === undefined ? [organizationId] : [organizationId, taskId];
  const taskRows = await rows(
    client,
    `SELECT *
       FROM aop.tasks
      WHERE organization_id = $1${predicate}
      ORDER BY created_at, id`,
    values,
  );
  const inputs = await loadTaskInputs(client, organizationId, taskId);
  return TaskListQuerySchema.parse(taskRows.map((row) => mapTask(row, inputs.get(String(row.id)) ?? [])));
}

async function loadApprovals(
  client: PoolClient,
  organizationId: OrganizationId,
  status?: ApprovalRequest["status"],
): Promise<readonly ApprovalRequest[]> {
  const predicate = status === undefined ? "" : " AND status = $2";
  const values: readonly unknown[] = status === undefined ? [organizationId] : [organizationId, status];
  const approvalRows = await rows(
    client,
    `SELECT *
       FROM aop.approval_requests
      WHERE organization_id = $1${predicate}
      ORDER BY created_at DESC, id DESC`,
    values,
  );
  return ApprovalListQuerySchema.parse(approvalRows.map(mapApproval));
}

function resourcesByDecision(rowsToMap: readonly QueryRow[]): ReadonlyMap<string, readonly ResourceRef[]> {
  const result = new Map<string, ResourceRef[]>();
  const seen = new Map<string, Set<string>>();
  for (const row of rowsToMap) {
    const decisionId = String(row.decision_id);
    const resource = ResourceRefSchema.parse({ type: row.resource_type, id: row.resource_id });
    const resourceKey = `${resource.type}:${resource.id}`;
    const decisionSeen = seen.get(decisionId) ?? new Set<string>();
    if (decisionSeen.has(resourceKey)) continue;
    decisionSeen.add(resourceKey);
    seen.set(decisionId, decisionSeen);
    const current = result.get(decisionId) ?? [];
    current.push(resource);
    result.set(decisionId, current);
  }
  return result;
}

async function loadDecisions(client: PoolClient, organizationId: OrganizationId): Promise<readonly Decision[]> {
  const decisionRows = await rows(
    client,
    `SELECT *
       FROM aop.decisions
      WHERE organization_id = $1
      ORDER BY updated_at DESC, id DESC`,
    [organizationId],
  );
  const impactRows = await rows(
    client,
    `SELECT decision_id, resource_type, resource_id
       FROM aop.decision_impacts
      WHERE organization_id = $1
      ORDER BY decision_id, created_at, resource_type, resource_id`,
    [organizationId],
  );
  const resources = resourcesByDecision(impactRows);
  return DecisionListQuerySchema.parse(decisionRows.map((row) => mapDecision(row, resources.get(String(row.id)) ?? [])));
}

function derivedParentsByVersion(rowsToMap: readonly QueryRow[]): ReadonlyMap<string, readonly ArtifactVersionId[]> {
  const result = new Map<string, ArtifactVersionId[]>();
  for (const row of rowsToMap) {
    const child = String(row.child_version_id);
    const current = result.get(child) ?? [];
    current.push(String(row.parent_version_id) as ArtifactVersionId);
    result.set(child, current);
  }
  return result;
}

async function withReadSnapshot<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresQueryStore implements OrganizationQueryStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async getOrganizationSnapshot(organizationId: OrganizationId): Promise<OrganizationSnapshot | undefined> {
    return withReadSnapshot(this.#pool, async (client) => {
      const organizationRow = await one(client, "SELECT * FROM aop.organizations WHERE id = $1", [organizationId]);
      if (organizationRow === undefined) return undefined;

      const agentRows = await rows(
        client,
        `SELECT a.*
           FROM aop.agents a
           JOIN aop.organization_memberships m ON m.agent_id = a.id
          WHERE m.organization_id = $1
          ORDER BY a.created_at, a.id`,
        [organizationId],
      );
      const membershipRows = await rows(
        client,
        `SELECT * FROM aop.organization_memberships
          WHERE organization_id = $1
          ORDER BY joined_at, id`,
        [organizationId],
      );
      const roleRows = await rows(
        client,
        `SELECT * FROM aop.roles
          WHERE organization_id = $1
          ORDER BY created_at, id`,
        [organizationId],
      );
      const roleAssignmentRows = await rows(
        client,
        `SELECT * FROM aop.role_assignments
          WHERE organization_id = $1
          ORDER BY active_from, role_id, agent_id`,
        [organizationId],
      );
      const goalRows = await rows(
        client,
        `SELECT * FROM aop.goals
          WHERE organization_id = $1
          ORDER BY created_at, id`,
        [organizationId],
      );
      const tasks = await loadTasks(client, organizationId);
      const pendingApprovals = await loadApprovals(client, organizationId, "pending");
      const eventRow = await one(
        client,
        `SELECT COALESCE(MAX(organization_sequence), 0) AS latest_event_sequence
           FROM aop.events
          WHERE organization_id = $1`,
        [organizationId],
      );
      const timeRow = await one(client, "SELECT transaction_timestamp() AS generated_at");

      if (eventRow === undefined || timeRow === undefined) throw new Error("Snapshot metadata query returned no row");

      return OrganizationSnapshotSchema.parse({
        organization: mapOrganization(organizationRow),
        agents: agentRows.map(mapAgent),
        memberships: membershipRows.map(mapMembership),
        roles: roleRows.map(mapRole),
        roleAssignments: roleAssignmentRows.map(mapRoleAssignment),
        goals: goalRows.map(mapGoal),
        tasks,
        pendingApprovals,
        latestEventSequence: Number(eventRow.latest_event_sequence),
        generatedAt:
          timeRow.generated_at instanceof Date
            ? timeRow.generated_at.toISOString()
            : new Date(String(timeRow.generated_at)).toISOString(),
      });
    });
  }

  async getTaskDetail(organizationId: OrganizationId, taskId: TaskId): Promise<TaskDetailQuery | undefined> {
    return withReadSnapshot(this.#pool, async (client) => {
      const tasks = await loadTasks(client, organizationId, taskId);
      const task = tasks[0];
      if (task === undefined) return undefined;

      const dependencyRows = await rows(
        client,
        `SELECT * FROM aop.task_dependencies
          WHERE organization_id = $1 AND task_id = $2
          ORDER BY depends_on_task_id`,
        [organizationId, taskId],
      );
      const runRows = await rows(
        client,
        `SELECT * FROM aop.task_runs
          WHERE organization_id = $1 AND task_id = $2
          ORDER BY attempt DESC, id DESC`,
        [organizationId, taskId],
      );
      const leaseRows = await rows(
        client,
        `SELECT * FROM aop.leases
          WHERE organization_id = $1 AND task_id = $2
          ORDER BY acquired_at DESC, id DESC`,
        [organizationId, taskId],
      );
      const reviewRows = await rows(
        client,
        `SELECT * FROM aop.reviews
          WHERE organization_id = $1 AND subject_type = 'task' AND subject_id = $2
          ORDER BY created_at DESC, id DESC`,
        [organizationId, taskId],
      );
      const outputRows = await rows(
        client,
        `SELECT artifact_version_id, deliverable_type
           FROM aop.task_artifact_outputs
          WHERE organization_id = $1 AND task_id = $2
          ORDER BY created_at, artifact_version_id`,
        [organizationId, taskId],
      );

      return TaskDetailQuerySchema.parse({
        task,
        dependencies: dependencyRows.map(mapTaskDependency),
        runs: runRows.map(mapTaskRun),
        leases: leaseRows.map(mapLease),
        reviews: reviewRows.map(mapReview),
        outputs: outputRows.map((row) =>
          TaskOutputRefSchema.parse({
            artifactVersionId: row.artifact_version_id,
            deliverableType: row.deliverable_type,
          }),
        ),
      });
    });
  }

  async getArtifactVersions(
    organizationId: OrganizationId,
    artifactId: ArtifactId,
  ): Promise<ArtifactVersionsQuery | undefined> {
    return withReadSnapshot(this.#pool, async (client) => {
      const artifactRow = await one(
        client,
        "SELECT * FROM aop.artifacts WHERE organization_id = $1 AND id = $2",
        [organizationId, artifactId],
      );
      if (artifactRow === undefined) return undefined;

      const versionRows = await rows(
        client,
        `SELECT * FROM aop.artifact_versions
          WHERE organization_id = $1 AND artifact_id = $2
          ORDER BY version, id`,
        [organizationId, artifactId],
      );
      const lineageRows = await rows(
        client,
        `SELECT l.child_version_id, l.parent_version_id
           FROM aop.artifact_lineage l
           JOIN aop.artifact_versions v
             ON v.organization_id = l.organization_id
            AND v.id = l.child_version_id
          WHERE l.organization_id = $1
            AND v.artifact_id = $2
            AND l.relationship = 'derived_from'
          ORDER BY l.child_version_id, l.created_at, l.parent_version_id`,
        [organizationId, artifactId],
      );
      const parents = derivedParentsByVersion(lineageRows);

      return ArtifactVersionsQuerySchema.parse({
        artifact: mapArtifact(artifactRow),
        versions: versionRows.map((row) => mapArtifactVersion(row, parents.get(String(row.id)) ?? [])),
      });
    });
  }

  async listEvents(organizationId: OrganizationId, afterSequence = 0, limit = 100): Promise<EventPage> {
    const safeAfter = Math.max(0, Math.trunc(afterSequence));
    const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
    const client = await this.#pool.connect();
    try {
      const eventRows = await rows(
        client,
        `SELECT * FROM aop.events
          WHERE organization_id = $1 AND organization_sequence > $2
          ORDER BY organization_sequence ASC
          LIMIT $3`,
        [organizationId, safeAfter, safeLimit + 1],
      );
      const hasMore = eventRows.length > safeLimit;
      const pageRows = hasMore ? eventRows.slice(0, safeLimit) : eventRows;
      const events = pageRows.map(mapEvent);
      const last = events.at(-1);
      return EventPageSchema.parse({
        organizationId,
        afterSequence: safeAfter,
        events,
        nextAfterSequence: last?.organizationSequence ?? safeAfter,
        hasMore,
      });
    } finally {
      client.release();
    }
  }

  async listDecisions(organizationId: OrganizationId): Promise<readonly Decision[]> {
    const client = await this.#pool.connect();
    try {
      return await loadDecisions(client, organizationId);
    } finally {
      client.release();
    }
  }

  async listApprovals(
    organizationId: OrganizationId,
    status?: ApprovalRequest["status"],
  ): Promise<readonly ApprovalRequest[]> {
    const client = await this.#pool.connect();
    try {
      return await loadApprovals(client, organizationId, status);
    } finally {
      client.release();
    }
  }

  async listGoals(organizationId: OrganizationId): Promise<readonly Goal[]> {
    const client = await this.#pool.connect();
    try {
      const goalRows = await rows(
        client,
        `SELECT * FROM aop.goals
          WHERE organization_id = $1
          ORDER BY created_at, id`,
        [organizationId],
      );
      return GoalListQuerySchema.parse(goalRows.map(mapGoal));
    } finally {
      client.release();
    }
  }

  async listTasks(organizationId: OrganizationId): Promise<readonly Task[]> {
    const client = await this.#pool.connect();
    try {
      return await loadTasks(client, organizationId);
    } finally {
      client.release();
    }
  }
}

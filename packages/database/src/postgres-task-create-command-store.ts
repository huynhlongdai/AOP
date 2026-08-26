import type { PoolClient } from "pg";

import type {
  TaskCreateAgentProfile,
  TaskCreateArtifactResolution,
  TaskCreateTransaction,
} from "@aop/command-bus";
import type {
  AgentId,
  GoalId,
  GoalStatus,
  OrganizationId,
  Task,
  TaskCreateArtifactInput,
  TaskDependency,
  TaskId,
} from "@aop/protocol";

import { PostgresReviewCommandTransaction } from "./postgres-review-command-store.js";
import type { QueryRow } from "./query-mappers.js";

async function rows(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow[]> {
  const result = await client.query<Record<string, unknown>>(text, [...values]);
  return result.rows;
}

async function one(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow | undefined> {
  return (await rows(client, text, values))[0];
}

function stringArray(value: unknown, field: string): string[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new TypeError(`${field} must be a string array`);
  }
  return parsed;
}

export class PostgresTaskCreateCommandTransaction
  extends PostgresReviewCommandTransaction
  implements TaskCreateTransaction
{
  readonly #taskCreateClient: PoolClient;

  constructor(client: PoolClient) {
    super(client);
    this.#taskCreateClient = client;
  }

  async lockTaskCreateIdentity(organizationId: OrganizationId, taskId: TaskId): Promise<boolean> {
    await this.#taskCreateClient.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 53))", [
      `task-create:${organizationId}:${taskId}`,
    ]);
    return (
      (await one(
        this.#taskCreateClient,
        "SELECT 1 FROM aop.tasks WHERE organization_id = $1 AND id = $2",
        [organizationId, taskId],
      )) !== undefined
    );
  }

  async goalStatus(organizationId: OrganizationId, goalId: GoalId): Promise<GoalStatus | undefined> {
    const row = await one(
      this.#taskCreateClient,
      "SELECT status FROM aop.goals WHERE organization_id = $1 AND id = $2 FOR SHARE",
      [organizationId, goalId],
    );
    return row === undefined ? undefined : (String(row.status) as GoalStatus);
  }

  async getTaskCreateAgentProfile(
    organizationId: OrganizationId,
    agentId: AgentId,
    now: string,
  ): Promise<TaskCreateAgentProfile | undefined> {
    const row = await one(
      this.#taskCreateClient,
      `SELECT m.status, a.capabilities,
              (SELECT count(*)
                 FROM aop.role_assignments ra
                WHERE ra.organization_id = m.organization_id
                  AND ra.agent_id = m.agent_id
                  AND ra.active_from <= $3::timestamptz
                  AND (ra.active_until IS NULL OR ra.active_until > $3::timestamptz)) AS active_role_count
         FROM aop.organization_memberships m
         JOIN aop.agents a ON a.id = m.agent_id
        WHERE m.organization_id = $1 AND m.agent_id = $2
        FOR SHARE OF m, a`,
      [organizationId, agentId, now],
    );
    if (row === undefined) return undefined;
    return {
      active: String(row.status) === "active",
      capabilities: stringArray(row.capabilities, "Agent capabilities"),
      activeRoleCount: Number(row.active_role_count),
    };
  }

  async resolveTaskCreateArtifactInputs(
    organizationId: OrganizationId,
    inputs: readonly TaskCreateArtifactInput[],
  ): Promise<TaskCreateArtifactResolution> {
    if (inputs.length === 0) return { inputs: [], invalid: [] };

    const ids = inputs.map((input) => input.artifactVersionId);
    const versionRows = await rows(
      this.#taskCreateClient,
      `SELECT av.id, av.artifact_id, av.status, a.current_approved_version_id
         FROM aop.artifact_versions av
         JOIN aop.artifacts a
           ON a.organization_id = av.organization_id
          AND a.id = av.artifact_id
        WHERE av.organization_id = $1
          AND av.id = ANY($2::text[])
        FOR SHARE OF av, a`,
      [organizationId, ids],
    );
    const byId = new Map(versionRows.map((row) => [String(row.id), row] as const));
    const resolved: TaskCreateArtifactResolution["inputs"][number][] = [];
    const invalid: TaskCreateArtifactResolution["invalid"][number][] = [];

    for (const input of inputs) {
      const row = byId.get(input.artifactVersionId);
      if (row === undefined) {
        invalid.push({ artifactVersionId: input.artifactVersionId, reason: "not_found" });
        continue;
      }

      const status = String(row.status);
      if (status !== "approved" && status !== "superseded") {
        invalid.push({ artifactVersionId: input.artifactVersionId, reason: "unreviewed" });
        continue;
      }
      if (
        input.required &&
        (status !== "approved" || String(row.current_approved_version_id ?? "") !== input.artifactVersionId)
      ) {
        invalid.push({ artifactVersionId: input.artifactVersionId, reason: "required_not_current" });
        continue;
      }

      resolved.push({
        artifactId: String(row.artifact_id) as Task["inputs"][number]["artifactId"],
        versionId: input.artifactVersionId,
        required: input.required,
      });
    }

    return { inputs: resolved, invalid };
  }

  async existingTaskIds(organizationId: OrganizationId, taskIds: readonly TaskId[]): Promise<readonly TaskId[]> {
    if (taskIds.length === 0) return [];
    const found = await rows(
      this.#taskCreateClient,
      `SELECT id FROM aop.tasks
        WHERE organization_id = $1 AND id = ANY($2::text[])
        ORDER BY id
        FOR SHARE`,
      [organizationId, [...taskIds]],
    );
    return found.map((row) => String(row.id) as TaskId);
  }

  async persistTaskCreate(parentTaskId: TaskId, task: Task, dependencies: readonly TaskDependency[]): Promise<void> {
    await this.#taskCreateClient.query(
      `INSERT INTO aop.tasks (
         id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
         owner_agent_id, reviewer_agent_id, priority, state, scope, deliverables,
         acceptance_criteria, required_capabilities, constraints, budget, revision,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20)`,
      [
        task.id,
        task.organizationId,
        task.goalId,
        task.title,
        task.objective,
        task.createdBy.type,
        task.createdBy.id,
        task.ownerAgentId ?? null,
        task.reviewerAgentId ?? null,
        task.priority,
        task.state,
        JSON.stringify(task.scope),
        JSON.stringify(task.deliverables),
        JSON.stringify(task.acceptanceCriteria),
        JSON.stringify(task.requiredCapabilities),
        JSON.stringify(task.constraints),
        JSON.stringify(task.budget),
        task.revision,
        task.createdAt,
        task.updatedAt,
      ],
    );

    for (const input of task.inputs) {
      await this.#taskCreateClient.query(
        `INSERT INTO aop.task_artifact_inputs (
           organization_id, task_id, artifact_version_id, required, created_at
         ) VALUES ($1,$2,$3,$4,$5)`,
        [task.organizationId, task.id, input.versionId, input.required, task.createdAt],
      );
    }

    for (const dependency of dependencies) {
      await this.#taskCreateClient.query(
        `INSERT INTO aop.task_dependencies (
           organization_id, task_id, depends_on_task_id, dependency_type, created_at
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          dependency.organizationId,
          dependency.taskId,
          dependency.dependsOnTaskId,
          dependency.type,
          task.createdAt,
        ],
      );
    }

    await this.#taskCreateClient.query(
      `INSERT INTO aop.task_decompositions (
         organization_id, parent_task_id, child_task_id, created_by_type, created_by_id, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [task.organizationId, parentTaskId, task.id, task.createdBy.type, task.createdBy.id, task.createdAt],
    );
  }
}

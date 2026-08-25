import type { Pool } from "pg";

import {
  TaskArtifactInputSchema,
  type ArtifactVersionId,
  type OrganizationId,
  type TaskArtifactInput,
  type TaskId,
} from "@aop/protocol";

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export interface TaskArtifactInputStatusStore {
  listTaskInputs(organizationId: OrganizationId, taskId: TaskId): Promise<readonly TaskArtifactInput[]>;
  listStaleRequiredVersions(organizationId: OrganizationId, taskId: TaskId): Promise<readonly ArtifactVersionId[]>;
}

export class PostgresTaskArtifactInputStatusStore implements TaskArtifactInputStatusStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listTaskInputs(organizationId: OrganizationId, taskId: TaskId): Promise<readonly TaskArtifactInput[]> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT artifact_id, artifact_version_id, required, invalidated_by_version_id, invalidated_at
         FROM aop.task_artifact_input_status
        WHERE organization_id = $1 AND task_id = $2
        ORDER BY created_at, artifact_version_id`,
      [organizationId, taskId],
    );

    return result.rows.map((row) => {
      const invalidatedByVersionId =
        row.invalidated_by_version_id === null || row.invalidated_by_version_id === undefined
          ? undefined
          : row.invalidated_by_version_id;
      const invalidatedAt =
        row.invalidated_at === null || row.invalidated_at === undefined ? undefined : timestamp(row.invalidated_at);

      return TaskArtifactInputSchema.parse({
        artifactId: row.artifact_id,
        versionId: row.artifact_version_id,
        required: Boolean(row.required),
        ...(invalidatedByVersionId === undefined ? {} : { invalidatedByVersionId, invalidatedAt }),
      });
    });
  }

  async listStaleRequiredVersions(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly ArtifactVersionId[]> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT artifact_version_id
         FROM aop.task_artifact_input_status
        WHERE organization_id = $1
          AND task_id = $2
          AND required = true
          AND stale = true
        ORDER BY artifact_version_id`,
      [organizationId, taskId],
    );
    return result.rows.map((row) => String(row.artifact_version_id) as ArtifactVersionId);
  }
}

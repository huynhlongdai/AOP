import type { Pool } from "pg";

import type {
  AgentId,
  ContextManifestId,
  LeaseId,
  LeaseStatus,
  OrganizationId,
  TaskId,
  TaskRunId,
  TaskRunStatus,
  TaskState,
} from "@aop/protocol";
import type {
  RuntimeExecutionControlState,
  RuntimeExecutionStateReader,
} from "@aop/runtime";

export class PostgresRuntimeExecutionStateReader implements RuntimeExecutionStateReader {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async getRuntimeExecutionState(
    organizationId: OrganizationId,
    runId: TaskRunId,
  ): Promise<RuntimeExecutionControlState | undefined> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT
         r.organization_id,
         r.id AS run_id,
         r.task_id,
         r.agent_id,
         r.status AS run_status,
         r.revision AS run_revision,
         r.runtime_type,
         r.runtime_id,
         t.state AS task_state,
         t.revision AS task_revision,
         l.id AS lease_id,
         l.status AS lease_status,
         l.revision AS lease_revision,
         l.heartbeat_interval_seconds,
         cm.id AS context_manifest_id
       FROM aop.task_runs r
       JOIN aop.tasks t
         ON t.organization_id = r.organization_id
        AND t.id = r.task_id
       JOIN aop.leases l
         ON l.organization_id = r.organization_id
        AND l.run_id = r.id
       LEFT JOIN aop.context_manifests cm
         ON cm.organization_id = r.organization_id
        AND cm.run_id = r.id
      WHERE r.organization_id = $1
        AND r.id = $2
      ORDER BY l.attempt DESC
      LIMIT 1`,
      [organizationId, runId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;

    const runtimeId = row.runtime_id === null || row.runtime_id === undefined ? undefined : String(row.runtime_id);
    const contextManifestId =
      row.context_manifest_id === null || row.context_manifest_id === undefined
        ? undefined
        : (String(row.context_manifest_id) as ContextManifestId);

    return {
      organizationId: String(row.organization_id) as OrganizationId,
      runId: String(row.run_id) as TaskRunId,
      taskId: String(row.task_id) as TaskId,
      agentId: String(row.agent_id) as AgentId,
      runStatus: String(row.run_status) as TaskRunStatus,
      runRevision: Number(row.run_revision),
      runtimeType: String(row.runtime_type),
      ...(runtimeId === undefined ? {} : { runtimeId }),
      taskState: String(row.task_state) as TaskState,
      taskRevision: Number(row.task_revision),
      leaseId: String(row.lease_id) as LeaseId,
      leaseStatus: String(row.lease_status) as LeaseStatus,
      leaseRevision: Number(row.lease_revision),
      heartbeatIntervalSeconds: Number(row.heartbeat_interval_seconds),
      ...(contextManifestId === undefined ? {} : { contextManifestId }),
    };
  }
}

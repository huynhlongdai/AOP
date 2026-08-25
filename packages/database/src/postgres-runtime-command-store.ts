import type { Pool, PoolClient } from "pg";

import type {
  CommandStore,
  CommandTransaction,
  RuntimeExecutionBundle,
  RuntimeLifecycleTransaction,
} from "@aop/command-bus";
import { DomainError } from "@aop/domain";
import type {
  ContextManifestId,
  Lease,
  OrganizationId,
  Task,
  TaskRun,
  TaskRunId,
} from "@aop/protocol";

import { mapLease, mapTaskRun, type QueryRow } from "./query-mappers.js";
import { PostgresCommandTransaction } from "./postgres-command-store.js";

async function one(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow | undefined> {
  const result = await client.query<Record<string, unknown>>(text, [...values]);
  return result.rows[0];
}

export class PostgresRuntimeCommandTransaction
  extends PostgresCommandTransaction
  implements RuntimeLifecycleTransaction
{
  readonly #runtimeClient: PoolClient;

  constructor(client: PoolClient) {
    super(client);
    this.#runtimeClient = client;
  }

  async lockRuntimeExecution(
    organizationId: OrganizationId,
    runId: TaskRunId,
  ): Promise<RuntimeExecutionBundle | undefined> {
    // Preserve the existing coordination lock order: Lease -> TaskRun -> Task.
    const leaseRow = await one(
      this.#runtimeClient,
      `SELECT * FROM aop.leases
        WHERE organization_id = $1 AND run_id = $2
        ORDER BY attempt DESC
        LIMIT 1
        FOR UPDATE`,
      [organizationId, runId],
    );
    if (leaseRow === undefined) return undefined;

    const runRow = await one(
      this.#runtimeClient,
      `SELECT * FROM aop.task_runs
        WHERE organization_id = $1 AND id = $2
        FOR UPDATE`,
      [organizationId, runId],
    );
    if (runRow === undefined) throw new Error("Runtime Lease references a missing TaskRun");

    const run = mapTaskRun(runRow);
    const task = await this.lockTask(organizationId, run.taskId);
    if (task === undefined) throw new Error("TaskRun references a missing Task");

    return { lease: mapLease(leaseRow), run, task };
  }

  async contextManifestMatchesRun(
    organizationId: OrganizationId,
    contextManifestId: ContextManifestId,
    run: TaskRun,
  ): Promise<boolean> {
    const row = await one(
      this.#runtimeClient,
      `SELECT 1
         FROM aop.context_manifests
        WHERE organization_id = $1
          AND id = $2
          AND run_id = $3
          AND task_id = $4
          AND agent_id = $5`,
      [organizationId, contextManifestId, run.id, run.taskId, run.agentId],
    );
    return row !== undefined;
  }

  async persistRuntimePrepared(run: TaskRun): Promise<void> {
    const previousRevision = run.revision - 1;
    const updated = await this.#runtimeClient.query(
      `UPDATE aop.task_runs
          SET status = 'preparing', runtime_id = $3, revision = $4
        WHERE organization_id = $1 AND id = $2
          AND revision = $5 AND status = 'created'`,
      [run.organizationId, run.id, run.runtimeId ?? null, run.revision, previousRevision],
    );
    if (updated.rowCount !== 1) {
      throw new DomainError("revision_conflict", "TaskRun changed before prepare persistence", {
        runId: run.id,
        expectedRevision: previousRevision,
      });
    }
  }

  async persistRuntimeStarted(run: TaskRun, task: Task): Promise<void> {
    const runPreviousRevision = run.revision - 1;
    const taskPreviousRevision = task.revision - 1;

    const runUpdated = await this.#runtimeClient.query(
      `UPDATE aop.task_runs
          SET status = 'running', started_at = $3, heartbeat_at = $4, revision = $5
        WHERE organization_id = $1 AND id = $2
          AND revision = $6 AND status = 'preparing'`,
      [run.organizationId, run.id, run.startedAt ?? null, run.heartbeatAt ?? null, run.revision, runPreviousRevision],
    );
    if (runUpdated.rowCount !== 1) {
      throw new DomainError("revision_conflict", "TaskRun changed before start persistence", {
        runId: run.id,
        expectedRevision: runPreviousRevision,
      });
    }

    const taskUpdated = await this.#runtimeClient.query(
      `UPDATE aop.tasks
          SET state = 'running', revision = $3, updated_at = $4
        WHERE organization_id = $1 AND id = $2
          AND revision = $5 AND state = 'leased'`,
      [task.organizationId, task.id, task.revision, task.updatedAt, taskPreviousRevision],
    );
    if (taskUpdated.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Task changed before Runtime start persistence", {
        taskId: task.id,
        expectedRevision: taskPreviousRevision,
      });
    }
  }

  async persistRuntimeFinished(run: TaskRun, lease: Lease, task: Task, taskRequeued: boolean): Promise<void> {
    const leasePreviousRevision = lease.revision - 1;
    const runPreviousRevision = run.revision - 1;

    const leaseUpdated = await this.#runtimeClient.query(
      `UPDATE aop.leases
          SET status = 'released', revision = $3
        WHERE organization_id = $1 AND id = $2
          AND revision = $4 AND status = 'active'`,
      [lease.organizationId, lease.id, lease.revision, leasePreviousRevision],
    );
    if (leaseUpdated.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Lease changed before Runtime finish persistence", {
        leaseId: lease.id,
        expectedRevision: leasePreviousRevision,
      });
    }

    const runUpdated = await this.#runtimeClient.query(
      `UPDATE aop.task_runs
          SET status = $3, finished_at = $4, failure_reason = $5, revision = $6
        WHERE organization_id = $1 AND id = $2
          AND revision = $7 AND status IN ('running','paused')`,
      [
        run.organizationId,
        run.id,
        run.status,
        run.finishedAt ?? null,
        run.failureReason ?? null,
        run.revision,
        runPreviousRevision,
      ],
    );
    if (runUpdated.rowCount !== 1) {
      throw new DomainError("revision_conflict", "TaskRun changed before finish persistence", {
        runId: run.id,
        expectedRevision: runPreviousRevision,
      });
    }

    if (taskRequeued) {
      const taskPreviousRevision = task.revision - 1;
      const taskUpdated = await this.#runtimeClient.query(
        `UPDATE aop.tasks
            SET owner_agent_id = NULL, state = 'ready', revision = $3, updated_at = $4,
                block_reason = NULL, block_detail = NULL, blocked_since = NULL, completed_at = NULL
          WHERE organization_id = $1 AND id = $2
            AND revision = $5 AND state IN ('leased','running')`,
        [task.organizationId, task.id, task.revision, task.updatedAt, taskPreviousRevision],
      );
      if (taskUpdated.rowCount !== 1) {
        throw new DomainError("revision_conflict", "Task changed before Runtime requeue persistence", {
          taskId: task.id,
          expectedRevision: taskPreviousRevision,
        });
      }
    }
  }
}

/**
 * Unified CommandStore for Runtime-enabled Organizations. It preserves all
 * existing PostgresCommandTransaction behavior and adds only Runtime lifecycle
 * primitives required by task_run.prepare/start/finish handlers.
 */
export class PostgresRuntimeCommandStore implements CommandStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async transaction<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresRuntimeCommandTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

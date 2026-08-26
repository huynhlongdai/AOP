import type { Pool, PoolClient } from "pg";

import type {
  ActiveTaskExecution,
  CommandStore,
  CommandTransaction,
  TaskReviewTransaction,
} from "@aop/command-bus";
import { DomainError } from "@aop/domain";
import type {
  ArtifactVersionId,
  OrganizationId,
  Review,
  ReviewId,
  Task,
  TaskId,
} from "@aop/protocol";

import { PostgresCommandTransaction } from "./postgres-command-store.js";
import { mapLease, mapReview, mapTaskRun, type QueryRow } from "./query-mappers.js";

async function one(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow | undefined> {
  const result = await client.query<Record<string, unknown>>(text, [...values]);
  return result.rows[0];
}

export class PostgresReviewCommandTransaction
  extends PostgresCommandTransaction
  implements TaskReviewTransaction
{
  readonly #reviewClient: PoolClient;

  constructor(client: PoolClient) {
    super(client);
    this.#reviewClient = client;
  }

  async staleRequiredArtifactInputs(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly ArtifactVersionId[]> {
    const result = await this.#reviewClient.query<Record<string, unknown>>(
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

  async lockActiveTaskExecution(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<ActiveTaskExecution | undefined> {
    const leaseRow = await one(
      this.#reviewClient,
      `SELECT *
         FROM aop.leases
        WHERE organization_id = $1 AND task_id = $2 AND status = 'active'
        FOR UPDATE`,
      [organizationId, taskId],
    );
    if (leaseRow === undefined) return undefined;

    const runRow = await one(
      this.#reviewClient,
      `SELECT *
         FROM aop.task_runs
        WHERE organization_id = $1 AND id = $2
        FOR UPDATE`,
      [organizationId, leaseRow.run_id],
    );
    if (runRow === undefined) {
      throw new DomainError("invariant_violation", "Active Lease references a missing TaskRun", {
        leaseId: leaseRow.id,
        runId: leaseRow.run_id,
      });
    }

    return { lease: mapLease(leaseRow), run: mapTaskRun(runRow) };
  }

  async persistTaskReviewSubmission(task: Task, review: Review): Promise<void> {
    const previousTaskRevision = task.revision - 1;

    const taskUpdate = await this.#reviewClient.query(
      `UPDATE aop.tasks
          SET state = 'review', revision = $3, updated_at = $4,
              block_reason = NULL, block_detail = NULL, blocked_since = NULL, completed_at = NULL
        WHERE organization_id = $1 AND id = $2 AND revision = $5 AND state = 'running'`,
      [task.organizationId, task.id, task.revision, task.updatedAt, previousTaskRevision],
    );
    if (taskUpdate.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Task changed before review submission", {
        taskId: task.id,
        expectedRevision: previousTaskRevision,
      });
    }

    await this.#reviewClient.query(
      `INSERT INTO aop.reviews (
         id, organization_id, subject_type, subject_id, reviewer_type, reviewer_id,
         criteria, evidence, result, findings, created_at, completed_at, revision
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11,$12,$13)`,
      [
        review.id,
        review.organizationId,
        review.subject.type,
        review.subject.id,
        review.reviewer.type,
        review.reviewer.id,
        JSON.stringify(review.criteria),
        JSON.stringify(review.evidence),
        review.result,
        JSON.stringify(review.findings),
        review.createdAt,
        review.completedAt ?? null,
        review.revision,
      ],
    );
  }

  async lockReview(organizationId: OrganizationId, reviewId: ReviewId): Promise<Review | undefined> {
    const reviewRow = await one(
      this.#reviewClient,
      `SELECT * FROM aop.reviews WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, reviewId],
    );
    return reviewRow === undefined ? undefined : mapReview(reviewRow);
  }

  async persistReviewResolution(review: Review, task: Task): Promise<void> {
    const previousReviewRevision = review.revision - 1;
    const previousTaskRevision = task.revision - 1;

    const reviewUpdate = await this.#reviewClient.query(
      `UPDATE aop.reviews
          SET evidence = $3::jsonb, result = $4, findings = $5::jsonb,
              completed_at = $6, revision = $7
        WHERE organization_id = $1 AND id = $2 AND revision = $8 AND result = 'pending'`,
      [
        review.organizationId,
        review.id,
        JSON.stringify(review.evidence),
        review.result,
        JSON.stringify(review.findings),
        review.completedAt ?? null,
        review.revision,
        previousReviewRevision,
      ],
    );
    if (reviewUpdate.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Review changed before resolution persistence", {
        reviewId: review.id,
        expectedRevision: previousReviewRevision,
      });
    }

    const taskUpdate = await this.#reviewClient.query(
      `UPDATE aop.tasks
          SET state = $3, revision = $4, updated_at = $5, completed_at = $6,
              block_reason = NULL, block_detail = NULL, blocked_since = NULL
        WHERE organization_id = $1 AND id = $2 AND revision = $7 AND state = 'review'`,
      [
        task.organizationId,
        task.id,
        task.state,
        task.revision,
        task.updatedAt,
        task.completedAt ?? null,
        previousTaskRevision,
      ],
    );
    if (taskUpdate.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Task changed before Review resolution persistence", {
        taskId: task.id,
        expectedRevision: previousTaskRevision,
      });
    }
  }
}

export class PostgresReviewCommandStore implements CommandStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async transaction<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresReviewCommandTransaction(client));
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

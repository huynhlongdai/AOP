import type { Pool, PoolClient } from "pg";

import {
  OrganizationReportSchema,
  type DecisionId,
  type OrganizationId,
  type OrganizationReport,
  type ReviewId,
  type TaskId,
} from "@aop/protocol";

interface CountRow {
  readonly key: string;
  readonly count: string | number;
}

interface IdRow {
  readonly id: string;
}

function countMap(rows: readonly CountRow[]): ReadonlyMap<string, number> {
  return new Map(rows.map((row) => [row.key, Number(row.count)]));
}

function count(map: ReadonlyMap<string, number>, key: string): number {
  return map.get(key) ?? 0;
}

async function buildReport(
  client: PoolClient,
  organizationId: OrganizationId,
  generatedAt: string,
): Promise<OrganizationReport | undefined> {
  const exists = await client.query("SELECT 1 FROM aop.organizations WHERE id = $1", [organizationId]);
  if (exists.rowCount === 0) return undefined;

  // A single pg client cannot safely execute concurrent queries. Keep these
  // reads sequential so the whole report remains inside one repeatable-read
  // snapshot and remains compatible with pg@9.
  const taskRows = await client.query<CountRow>(
    "SELECT state AS key, count(*) AS count FROM aop.tasks WHERE organization_id = $1 GROUP BY state",
    [organizationId],
  );
  const runRows = await client.query<CountRow>(
    "SELECT status AS key, count(*) AS count FROM aop.task_runs WHERE organization_id = $1 GROUP BY status",
    [organizationId],
  );
  const leaseRows = await client.query<CountRow>(
    "SELECT status AS key, count(*) AS count FROM aop.leases WHERE organization_id = $1 GROUP BY status",
    [organizationId],
  );
  const decisionRows = await client.query<CountRow>(
    "SELECT status AS key, count(*) AS count FROM aop.decisions WHERE organization_id = $1 GROUP BY status",
    [organizationId],
  );
  const reviewRows = await client.query<CountRow>(
    "SELECT result AS key, count(*) AS count FROM aop.reviews WHERE organization_id = $1 GROUP BY result",
    [organizationId],
  );
  const artifactRows = await client.query<{ total: string | number; approved: string | number }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE current_approved_version_id IS NOT NULL) AS approved
       FROM aop.artifacts
      WHERE organization_id = $1`,
    [organizationId],
  );
  const staleLinkRows = await client.query<{ count: string | number }>(
    `SELECT count(*) AS count
       FROM aop.task_artifact_input_status
      WHERE organization_id = $1 AND required = true AND stale = true`,
    [organizationId],
  );
  const staleCompletedRows = await client.query<{ count: string | number }>(
    `SELECT count(*) AS count
       FROM aop.tasks task
      WHERE task.organization_id = $1
        AND task.state = 'completed'
        AND EXISTS (
          SELECT 1
            FROM aop.task_artifact_input_status input_status
           WHERE input_status.organization_id = task.organization_id
             AND input_status.task_id = task.id
             AND input_status.required = true
             AND input_status.stale = true
        )`,
    [organizationId],
  );
  const blockedTaskRows = await client.query<IdRow>(
    "SELECT id FROM aop.tasks WHERE organization_id = $1 AND state = 'blocked' ORDER BY id",
    [organizationId],
  );
  const staleTaskRows = await client.query<IdRow>(
    `SELECT DISTINCT task_id AS id
       FROM aop.task_artifact_input_status
      WHERE organization_id = $1 AND required = true AND stale = true
      ORDER BY task_id`,
    [organizationId],
  );
  const blockingDecisionRows = await client.query<IdRow>(
    `SELECT DISTINCT impact.decision_id AS id
       FROM aop.decision_impacts impact
       JOIN aop.decisions decision
         ON decision.organization_id = impact.organization_id
        AND decision.id = impact.decision_id
      WHERE impact.organization_id = $1
        AND impact.impact_type = 'blocks'
        AND decision.status NOT IN ('rejected','superseded')
      ORDER BY impact.decision_id`,
    [organizationId],
  );
  const pendingDecisionRows = await client.query<IdRow>(
    `SELECT id
       FROM aop.decisions
      WHERE organization_id = $1 AND status IN ('proposed','discussion','approval_pending')
      ORDER BY id`,
    [organizationId],
  );
  const reworkReviewRows = await client.query<IdRow>(
    "SELECT id FROM aop.reviews WHERE organization_id = $1 AND result = 'rework' ORDER BY id",
    [organizationId],
  );
  const eventRows = await client.query<{ latest: string | number }>(
    "SELECT COALESCE(MAX(organization_sequence), 0) AS latest FROM aop.events WHERE organization_id = $1",
    [organizationId],
  );

  const tasks = countMap(taskRows.rows);
  const runs = countMap(runRows.rows);
  const leases = countMap(leaseRows.rows);
  const decisions = countMap(decisionRows.rows);
  const reviews = countMap(reviewRows.rows);
  const historicalCompletedTasks = count(tasks, "completed");
  const staleCompletedTasks = Number(staleCompletedRows.rows[0]?.count ?? 0);
  const verifiedCompletedTasks = Math.max(0, historicalCompletedTasks - staleCompletedTasks);
  const eligibleTasks =
    [...tasks.values()].reduce((total, value) => total + value, 0) - count(tasks, "cancelled") - count(tasks, "rejected");
  const artifactCounts = artifactRows.rows[0] ?? { total: 0, approved: 0 };
  const staleLinks = staleLinkRows.rows[0]?.count ?? 0;
  const latestEventSequence = Number(eventRows.rows[0]?.latest ?? 0);

  return OrganizationReportSchema.parse({
    organizationId,
    generatedAt,
    latestEventSequence,
    tasks: {
      proposed: count(tasks, "proposed"),
      ready: count(tasks, "ready"),
      leased: count(tasks, "leased"),
      running: count(tasks, "running"),
      blocked: count(tasks, "blocked"),
      review: count(tasks, "review"),
      completed: historicalCompletedTasks,
      failed: count(tasks, "failed"),
      cancelled: count(tasks, "cancelled"),
      rejected: count(tasks, "rejected"),
    },
    taskRuns: {
      created: count(runs, "created"),
      preparing: count(runs, "preparing"),
      running: count(runs, "running"),
      paused: count(runs, "paused"),
      succeeded: count(runs, "succeeded"),
      failed: count(runs, "failed"),
      lost: count(runs, "lost"),
      cancelled: count(runs, "cancelled"),
    },
    leases: {
      active: count(leases, "active"),
      expired: count(leases, "expired"),
      released: count(leases, "released"),
    },
    decisions: {
      proposed: count(decisions, "proposed"),
      discussion: count(decisions, "discussion"),
      approvalPending: count(decisions, "approval_pending"),
      active: count(decisions, "active"),
      rejected: count(decisions, "rejected"),
      superseded: count(decisions, "superseded"),
    },
    reviews: {
      pending: count(reviews, "pending"),
      pass: count(reviews, "pass"),
      rework: count(reviews, "rework"),
      fail: count(reviews, "fail"),
    },
    artifacts: {
      total: Number(artifactCounts.total),
      withCurrentApprovedVersion: Number(artifactCounts.approved),
      staleConsumerLinks: Number(staleLinks),
    },
    verifiedProgress: {
      eligibleTasks,
      verifiedCompletedTasks,
      staleCompletedTasks,
      ratio: eligibleTasks === 0 ? 0 : verifiedCompletedTasks / eligibleTasks,
    },
    blockers: {
      blockedTaskIds: blockedTaskRows.rows.map((row) => row.id as TaskId),
      staleInputTaskIds: staleTaskRows.rows.map((row) => row.id as TaskId),
      blockingDecisionIds: blockingDecisionRows.rows.map((row) => row.id as DecisionId),
    },
    attention: {
      pendingDecisionIds: pendingDecisionRows.rows.map((row) => row.id as DecisionId),
      reworkReviewIds: reworkReviewRows.rows.map((row) => row.id as ReviewId),
    },
  });
}

export class PostgresReportingStore {
  readonly #pool: Pool;
  readonly #now: () => string;

  constructor(pool: Pool, now: () => string = () => new Date().toISOString()) {
    this.#pool = pool;
    this.#now = now;
  }

  async getOrganizationReport(organizationId: OrganizationId): Promise<OrganizationReport | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const report = await buildReport(client, organizationId, this.#now());
      await client.query("COMMIT");
      return report;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

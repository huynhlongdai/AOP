import type { Pool } from "pg";

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

export class PostgresReportingStore {
  readonly #pool: Pool;
  readonly #now: () => string;

  constructor(pool: Pool, now: () => string = () => new Date().toISOString()) {
    this.#pool = pool;
    this.#now = now;
  }

  async getOrganizationReport(organizationId: OrganizationId): Promise<OrganizationReport | undefined> {
    const exists = await this.#pool.query("SELECT 1 FROM aop.organizations WHERE id = $1", [organizationId]);
    if (exists.rowCount === 0) return undefined;

    const [
      taskRows,
      runRows,
      leaseRows,
      decisionRows,
      reviewRows,
      artifactRows,
      staleLinkRows,
      blockedTaskRows,
      staleTaskRows,
      pendingDecisionRows,
      reworkReviewRows,
      eventRows,
    ] = await Promise.all([
      this.#pool.query<CountRow>(
        "SELECT state AS key, count(*) AS count FROM aop.tasks WHERE organization_id = $1 GROUP BY state",
        [organizationId],
      ),
      this.#pool.query<CountRow>(
        "SELECT status AS key, count(*) AS count FROM aop.task_runs WHERE organization_id = $1 GROUP BY status",
        [organizationId],
      ),
      this.#pool.query<CountRow>(
        "SELECT status AS key, count(*) AS count FROM aop.leases WHERE organization_id = $1 GROUP BY status",
        [organizationId],
      ),
      this.#pool.query<CountRow>(
        "SELECT status AS key, count(*) AS count FROM aop.decisions WHERE organization_id = $1 GROUP BY status",
        [organizationId],
      ),
      this.#pool.query<CountRow>(
        "SELECT result AS key, count(*) AS count FROM aop.reviews WHERE organization_id = $1 GROUP BY result",
        [organizationId],
      ),
      this.#pool.query<{ total: string | number; approved: string | number }>(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE current_approved_version_id IS NOT NULL) AS approved
           FROM aop.artifacts
          WHERE organization_id = $1`,
        [organizationId],
      ),
      this.#pool.query<{ count: string | number }>(
        `SELECT count(*) AS count
           FROM aop.task_artifact_input_status
          WHERE organization_id = $1 AND required = true AND stale = true`,
        [organizationId],
      ),
      this.#pool.query<IdRow>(
        "SELECT id FROM aop.tasks WHERE organization_id = $1 AND state = 'blocked' ORDER BY id",
        [organizationId],
      ),
      this.#pool.query<{ id: string }>(
        `SELECT DISTINCT task_id AS id
           FROM aop.task_artifact_input_status
          WHERE organization_id = $1 AND required = true AND stale = true
          ORDER BY task_id`,
        [organizationId],
      ),
      this.#pool.query<IdRow>(
        `SELECT id
           FROM aop.decisions
          WHERE organization_id = $1 AND status IN ('proposed','discussion','approval_pending')
          ORDER BY id`,
        [organizationId],
      ),
      this.#pool.query<IdRow>(
        "SELECT id FROM aop.reviews WHERE organization_id = $1 AND result = 'rework' ORDER BY id",
        [organizationId],
      ),
      this.#pool.query<{ latest: string | number }>(
        "SELECT COALESCE(MAX(organization_sequence), 0) AS latest FROM aop.events WHERE organization_id = $1",
        [organizationId],
      ),
    ]);

    const tasks = countMap(taskRows.rows);
    const runs = countMap(runRows.rows);
    const leases = countMap(leaseRows.rows);
    const decisions = countMap(decisionRows.rows);
    const reviews = countMap(reviewRows.rows);
    const completedTasks = count(tasks, "completed");
    const eligibleTasks =
      [...tasks.values()].reduce((total, value) => total + value, 0) - count(tasks, "cancelled") - count(tasks, "rejected");
    const artifactCounts = artifactRows.rows[0] ?? { total: 0, approved: 0 };
    const staleLinks = staleLinkRows.rows[0]?.count ?? 0;
    const latestEventSequence = Number(eventRows.rows[0]?.latest ?? 0);

    return OrganizationReportSchema.parse({
      organizationId,
      generatedAt: this.#now(),
      latestEventSequence,
      tasks: {
        proposed: count(tasks, "proposed"),
        ready: count(tasks, "ready"),
        leased: count(tasks, "leased"),
        running: count(tasks, "running"),
        blocked: count(tasks, "blocked"),
        review: count(tasks, "review"),
        completed: completedTasks,
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
        completedTasks,
        ratio: eligibleTasks === 0 ? 0 : completedTasks / eligibleTasks,
      },
      blockers: {
        blockedTaskIds: blockedTaskRows.rows.map((row) => row.id as TaskId),
        staleInputTaskIds: staleTaskRows.rows.map((row) => row.id as TaskId),
        pendingDecisionIds: pendingDecisionRows.rows.map((row) => row.id as DecisionId),
        reworkReviewIds: reworkReviewRows.rows.map((row) => row.id as ReviewId),
      },
    });
  }
}

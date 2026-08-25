import type { Pool } from "pg";

import {
  AgentIdSchema,
  OrganizationIdSchema,
  PrioritySchema,
  TaskIdSchema,
} from "@aop/protocol";

import type { SchedulerCandidate, SchedulerCandidateStore } from "./scheduler.js";

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) throw new TypeError("Expected scheduler timestamp");
  return parsed.toISOString();
}

export class PostgresSchedulerCandidateStore implements SchedulerCandidateStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listCandidates(limit: number, now: string): Promise<readonly SchedulerCandidate[]> {
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT
         t.organization_id,
         t.id AS task_id,
         t.revision AS task_revision,
         t.updated_at AS task_updated_at,
         t.priority,
         selected.agent_id,
         selected.runtime_type,
         COALESCE((
           SELECT MAX(tr.attempt) + 1
             FROM aop.task_runs tr
            WHERE tr.organization_id = t.organization_id AND tr.task_id = t.id
         ), 1) AS next_attempt
       FROM aop.tasks t
       JOIN aop.organizations o ON o.id = t.organization_id AND o.status = 'active'
       JOIN aop.goals g ON g.organization_id = t.organization_id AND g.id = t.goal_id AND g.status = 'active'
       JOIN LATERAL (
         SELECT a.id AS agent_id, a.runtime ->> 'adapter' AS runtime_type
           FROM aop.organization_memberships m
           JOIN aop.agents a ON a.id = m.agent_id
          WHERE m.organization_id = t.organization_id
            AND m.status = 'active'
            AND (t.owner_agent_id IS NULL OR t.owner_agent_id = a.id)
            AND a.capabilities @> t.required_capabilities
            AND NULLIF(a.runtime ->> 'adapter', '') IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM aop.role_assignments ra
               WHERE ra.organization_id = t.organization_id
                 AND ra.agent_id = a.id
                 AND ra.active_from <= $1
                 AND (ra.active_until IS NULL OR ra.active_until > $1)
            )
            AND NOT EXISTS (
              SELECT 1
                FROM aop.leases l
               WHERE l.organization_id = t.organization_id
                 AND l.agent_id = a.id
                 AND l.status = 'active'
            )
          ORDER BY a.id
          LIMIT 1
       ) selected ON true
       WHERE t.state = 'ready'
         AND NOT EXISTS (
           SELECT 1
             FROM aop.task_dependencies d
             JOIN aop.tasks prerequisite
               ON prerequisite.organization_id = d.organization_id
              AND prerequisite.id = d.depends_on_task_id
            WHERE d.organization_id = t.organization_id
              AND d.task_id = t.id
              AND d.dependency_type = 'hard'
              AND prerequisite.state <> 'completed'
         )
         AND NOT EXISTS (
           SELECT 1
             FROM aop.task_artifact_inputs tai
            WHERE tai.organization_id = t.organization_id
              AND tai.task_id = t.id
              AND tai.required = true
              AND tai.invalidated_by_version_id IS NOT NULL
         )
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         t.created_at,
         t.id,
         selected.agent_id
       LIMIT $2`,
      [now, safeLimit],
    );

    return result.rows.map((row) => ({
      organizationId: OrganizationIdSchema.parse(row.organization_id),
      taskId: TaskIdSchema.parse(row.task_id),
      taskRevision: Number(row.task_revision),
      taskUpdatedAt: timestamp(row.task_updated_at),
      priority: PrioritySchema.parse(row.priority),
      agentId: AgentIdSchema.parse(row.agent_id),
      runtimeType: String(row.runtime_type),
      attempt: Number(row.next_attempt),
    }));
  }
}

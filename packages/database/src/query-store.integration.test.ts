import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type { OrganizationId, TaskId } from "@aop/protocol";

import { PostgresQueryStore } from "./query-store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl === undefined ? describe.skip : describe;

const organizationId = "org_00000000000000000000000011" as OrganizationId;
const agentId = "agt_00000000000000000000000011";
const membershipId = "mem_00000000000000000000000011";
const goalId = "gol_00000000000000000000000011";
const taskId = "tsk_00000000000000000000000011" as TaskId;
const artifactId = "art_00000000000000000000000011";
const artifactVersionId = "arv_00000000000000000000000011";
const eventOneId = "evt_00000000000000000000000011";
const eventTwoId = "evt_00000000000000000000000012";
const ownerId = "usr_00000000000000000000000011";

const pool = databaseUrl === undefined ? undefined : new Pool({ connectionString: databaseUrl });

async function seed(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM aop.agents WHERE id = $1", [agentId]);

  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, root_goal_id,
       autonomy_level, revision, created_at, updated_at
     ) VALUES ($1, 'Query Store Org', 'company', 'active', 'Validate read models', 'human', $2, NULL,
       'human_managed', 0, now(), now())`,
    [organizationId, ownerId],
  );

  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES ($1, 'Query Agent', '0.1.0', 'Integration test agent', '["backend"]'::jsonb,
       '{"adapter":"test.runtime","provider":"integration"}'::jsonb, 0, now(), now())`,
    [agentId],
  );

  await pool.query(
    `INSERT INTO aop.organization_memberships (
       id, organization_id, agent_id, status, joined_at, left_at, revision
     ) VALUES ($1, $2, $3, 'active', now(), NULL, 0)`,
    [membershipId, organizationId, agentId],
  );

  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, parent_goal_id, title, objective, owner_type, owner_id,
       success_criteria, priority, status, revision, created_at, updated_at, completed_at
     ) VALUES ($1, $2, NULL, 'Ship observer API', 'Expose authoritative organization state', 'human', $3,
       '["observer API returns valid protocol objects"]'::jsonb, 'high', 'active', 0, now(), now(), NULL)`,
    [goalId, organizationId, ownerId],
  );

  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       owner_agent_id, reviewer_agent_id, priority, state, scope, deliverables,
       acceptance_criteria, required_capabilities, constraints, budget, revision,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'Implement observer API', 'Build read-only snapshot endpoints', 'human', $4,
       $5, NULL, 'high', 'ready',
       '{"includes":["apps/api/**"],"excludes":[]}'::jsonb,
       '[{"type":"code","description":"Observer API","required":true}]'::jsonb,
       '["integration tests pass"]'::jsonb,
       '["backend"]'::jsonb, '{}'::jsonb, '{}'::jsonb, 0, now(), now())`,
    [taskId, organizationId, goalId, ownerId, agentId],
  );

  await pool.query(
    `INSERT INTO aop.artifacts (
       id, organization_id, type, title, current_approved_version_id, revision, created_at, updated_at
     ) VALUES ($1, $2, 'spec.api', 'Observer contract', NULL, 0, now(), now())`,
    [artifactId, organizationId],
  );

  await pool.query(
    `INSERT INTO aop.artifact_versions (
       id, organization_id, artifact_id, version, status, created_by_type, created_by_id,
       produced_by_task_id, content_uri, mime_type, checksum, size_bytes, content_schema,
       supersedes_version_id, approved_by_type, approved_by_id, approved_at, created_at
     ) VALUES ($1, $2, $3, 1, 'draft', 'human', $4, NULL,
       'aop://query-store/spec/1', 'application/json',
       'sha256:0000000000000000000000000000000000000000000000000000000000000000',
       128, NULL, NULL, NULL, NULL, NULL, now())`,
    [artifactVersionId, organizationId, artifactId, ownerId],
  );

  await pool.query(
    `INSERT INTO aop.task_artifact_inputs (
       organization_id, task_id, artifact_version_id, required, created_at
     ) VALUES ($1, $2, $3, true, now())`,
    [organizationId, taskId, artifactVersionId],
  );

  await pool.query(
    `INSERT INTO aop.events (
       id, organization_id, organization_sequence, type, aggregate_type, aggregate_id,
       aggregate_revision, actor_type, actor_id, causation_id, correlation_id, payload, occurred_at,
       schema_version, protocol_version
     ) VALUES
       ($1, $3, 1, 'task.created', 'task', $4, 0, 'human', $5, NULL, 'query-store-test', '{}'::jsonb, now(), 1, '0.1.0'),
       ($2, $3, 2, 'task.ready', 'task', $4, 1, 'human', $5, NULL, 'query-store-test', '{}'::jsonb, now(), 1, '0.1.0')`,
    [eventOneId, eventTwoId, organizationId, taskId, ownerId],
  );
}

describeWithDatabase("PostgresQueryStore", () => {
  beforeAll(seed);

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query("DELETE FROM aop.organizations WHERE id = $1", [organizationId]);
    await pool.query("DELETE FROM aop.agents WHERE id = $1", [agentId]);
    await pool.end();
  });

  it("reconstructs one protocol-valid authoritative organization snapshot", async () => {
    if (pool === undefined) throw new Error("DATABASE_URL is required");
    const store = new PostgresQueryStore(pool);
    const snapshot = await store.getOrganizationSnapshot(organizationId);

    expect(snapshot).toBeDefined();
    expect(snapshot?.organization.id).toBe(organizationId);
    expect(snapshot?.agents).toHaveLength(1);
    expect(snapshot?.tasks).toHaveLength(1);
    expect(snapshot?.tasks[0]?.inputs).toEqual([
      {
        artifactId,
        versionId: artifactVersionId,
        required: true,
      },
    ]);
    expect(snapshot?.latestEventSequence).toBe(2);
  });

  it("returns task detail from the same authoritative relationships", async () => {
    if (pool === undefined) throw new Error("DATABASE_URL is required");
    const store = new PostgresQueryStore(pool);
    const detail = await store.getTaskDetail(organizationId, taskId);

    expect(detail?.task.id).toBe(taskId);
    expect(detail?.task.inputs).toHaveLength(1);
    expect(detail?.runs).toEqual([]);
    expect(detail?.leases).toEqual([]);
    expect(detail?.reviews).toEqual([]);
  });

  it("paginates events strictly by organization sequence without replaying the cursor event", async () => {
    if (pool === undefined) throw new Error("DATABASE_URL is required");
    const store = new PostgresQueryStore(pool);

    const first = await store.listEvents(organizationId, 0, 1);
    expect(first.events.map((item) => item.organizationSequence)).toEqual([1]);
    expect(first.nextAfterSequence).toBe(1);
    expect(first.hasMore).toBe(true);

    const second = await store.listEvents(organizationId, first.nextAfterSequence, 10);
    expect(second.events.map((item) => item.organizationSequence)).toEqual([2]);
    expect(second.nextAfterSequence).toBe(2);
    expect(second.hasMore).toBe(false);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { ContextCompileError } from "@aop/context-engine";
import type { ContextManifestId, OrganizationId, TaskRunId } from "@aop/protocol";

import { PostgresContextManifestStore } from "./context-manifest-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(91)}` as OrganizationId;
const ownerId = `usr_${ulid(91)}`;
const agentId = `agt_${ulid(91)}`;
const roleId = `rol_${ulid(91)}`;
const goalId = `gol_${ulid(91)}`;
const taskId = `tsk_${ulid(91)}`;
const runId = `run_${ulid(91)}` as TaskRunId;
const artifactId = `art_${ulid(91)}`;
const artifactV1 = `arv_${ulid(91)}`;
const artifactV2 = `arv_${ulid(92)}`;
const decisionId = `dec_${ulid(91)}`;
const now = "2026-08-25T16:00:00.000Z";
const later = "2026-08-25T16:05:00.000Z";
const digest = (digit: string) => `sha256:${digit.repeat(64)}`;

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.context_manifests WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM aop.task_runs WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [orgId]);
  await pool.query("DELETE FROM aop.agents WHERE id = $1", [agentId]);
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");

  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES ($1,'Context Org','company','active','Build with bounded agents','human',$2,'assistant_managed',0,$3,$3)`,
    [orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES ($1,'CTO Agent','0.1.0','Decomposes engineering work','["planning","task.create"]',
               '{"adapter":"runtime.openai","provider":"openai","modelPolicy":"cto-default"}',0,$2,$2)`,
    [agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (
       id, organization_id, agent_id, status, joined_at, revision
     ) VALUES ($1,$2,$3,'active',$4,0)`,
    [`mem_${ulid(91)}`, orgId, agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.roles (
       id, organization_id, name, purpose, responsibilities, authority, revision, created_at, updated_at
     ) VALUES ($1,$2,'CTO','Own engineering decomposition','["Plan architecture","Create engineering tasks"]',
       '{"allowedCapabilities":["task.create","decision.create"],"approvalRequiredCapabilities":["deploy.production"],"deniedCapabilities":["permission.grant"]}',
       0,$3,$3)`,
    [roleId, orgId, now],
  );
  await pool.query(
    `INSERT INTO aop.role_assignments (
       organization_id, agent_id, role_id, active_from
     ) VALUES ($1,$2,$3,$4)`,
    [orgId, agentId, roleId, "2026-08-25T15:00:00.000Z"],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES ($1,$2,'agent',$3,'task.create','allow','{}','human',$4,0,$5)`,
    [`per_${ulid(91)}`, orgId, agentId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Ship MVP','Create a verified product plan','human',$3,'["Task graph accepted"]','critical','active',0,$4,$4)`,
    [goalId, orgId, ownerId, now],
  );

  await pool.query(
    `INSERT INTO aop.artifacts (
       id, organization_id, type, title, current_approved_version_id, revision, created_at, updated_at
     ) VALUES ($1,$2,'product.spec','Founder product brief',NULL,0,$3,$3)`,
    [artifactId, orgId, now],
  );
  await pool.query(
    `INSERT INTO aop.artifact_versions (
       id, organization_id, artifact_id, version, status, created_by_type, created_by_id,
       content_uri, mime_type, checksum, size_bytes, approved_by_type, approved_by_id, approved_at, created_at
     ) VALUES ($1,$2,$3,1,'approved','human',$4,$5,'text/markdown',$6,512,'human',$4,$7,$7)`,
    [artifactV1, orgId, artifactId, ownerId, `aop://${orgId}/artifacts/${artifactId}/versions/${artifactV1}`, digest("1"), now],
  );
  await pool.query(
    `UPDATE aop.artifacts
        SET current_approved_version_id = $3, revision = 1, updated_at = $4
      WHERE organization_id = $1 AND id = $2`,
    [orgId, artifactId, artifactV1, now],
  );

  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       owner_agent_id, reviewer_agent_id, priority, state, scope, deliverables,
       acceptance_criteria, required_capabilities, constraints, budget, revision, created_at, updated_at
     ) VALUES ($1,$2,$3,'Decompose engineering work','Create Backend, Frontend and QA Work Contracts',
       'human',$4,$5,NULL,'critical','running',
       '{"includes":["architecture","task decomposition"],"excludes":["production deploy"]}',
       '[{"type":"work.plan","description":"Engineering task graph","required":true}]',
       '["All child tasks have acceptance criteria"]','["task.create"]','{"maxDepth":2}',
       '{"maxTokens":12000,"maxToolCalls":20}',2,$6,$6)`,
    [taskId, orgId, goalId, ownerId, agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.task_artifact_inputs (
       organization_id, task_id, artifact_version_id, required, created_at
     ) VALUES ($1,$2,$3,true,$4)`,
    [orgId, taskId, artifactV1, now],
  );
  await pool.query(
    `INSERT INTO aop.task_runs (
       id, organization_id, task_id, agent_id, attempt, status, runtime_type,
       runtime_id, workspace_id, started_at, heartbeat_at, revision
     ) VALUES ($1,$2,$3,$4,1,'running','runtime.openai','provider-runtime-context','workspace-context-test',$5,$5,2)`,
    [runId, orgId, taskId, agentId, now],
  );

  await pool.query(
    `INSERT INTO aop.decisions (
       id, organization_id, scope, question, options, selected_option_id, rationale,
       proposed_by_type, proposed_by_id, authority_capability, status,
       approved_by_type, approved_by_id, effective_at, revision, created_at, updated_at
     ) VALUES ($1,$2,'engineering.architecture','Which architecture boundary is authoritative?',
       '[{"id":"modular","label":"Modular monolith"}]','modular','Approved for PoC',
       'human',$3,'decision.architecture.approve','active','human',$3,$4,1,$4,$4)`,
    [decisionId, orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.decision_impacts (
       organization_id, decision_id, resource_type, resource_id, impact_type, created_at
     ) VALUES ($1,$2,'task',$3,'affected',$4)`,
    [orgId, decisionId, taskId, now],
  );
}

beforeEach(async () => {
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await pool?.end();
});

describeDb("PostgreSQL Context Manifest compilation", () => {
  it("persists an exact mandatory manifest from the running authoritative revision", async () => {
    if (pool === undefined) return;
    const store = new PostgresContextManifestStore(pool, () => now);
    const manifestId = `ctx_${ulid(91)}` as ContextManifestId;

    const manifest = await store.compileInitialManifest({ organizationId: orgId, runId, manifestId, maxTokens: 16_000 });

    expect(manifest.id).toBe(manifestId);
    expect(manifest.taskRevision).toBe(2);
    expect(manifest.totalTokenEstimate).toBeLessThanOrEqual(12_000);
    expect(manifest.fragments.map((fragment) => fragment.kind)).toEqual([
      "policy",
      "identity",
      "role",
      "authority",
      "goal",
      "task",
      "decision",
      "artifact",
      "output_contract",
    ]);
    expect(manifest.fragments.find((fragment) => fragment.kind === "decision")?.mandatory).toBe(true);
    expect(manifest.fragments.find((fragment) => fragment.kind === "artifact")?.mandatory).toBe(true);
    expect(manifest.fragments.every((fragment) => fragment.content.length > 0 && fragment.digest.startsWith("sha256:"))).toBe(true);

    expect(await store.getForRun(orgId, runId)).toEqual(manifest);
    const persisted = await pool.query("SELECT count(*)::int AS count FROM aop.context_manifests WHERE organization_id=$1 AND run_id=$2", [orgId, runId]);
    expect(persisted.rows[0]?.count).toBe(1);
  });

  it("rejects compilation before the Run and Task reach their authoritative running revisions", async () => {
    if (pool === undefined) return;
    await pool.query(
      `UPDATE aop.task_runs
          SET status='created', runtime_id=NULL, started_at=NULL, heartbeat_at=NULL, revision=0
        WHERE organization_id=$1 AND id=$2`,
      [orgId, runId],
    );
    await pool.query(
      `UPDATE aop.tasks SET state='leased', revision=1, updated_at=$3
        WHERE organization_id=$1 AND id=$2`,
      [orgId, taskId, now],
    );

    const store = new PostgresContextManifestStore(pool, () => now);
    await expect(
      store.compileInitialManifest({
        organizationId: orgId,
        runId,
        manifestId: `ctx_${ulid(98)}` as ContextManifestId,
        maxTokens: 16_000,
      }),
    ).rejects.toMatchObject({ code: "invariant_violation" });
    expect(await store.getForRun(orgId, runId)).toBeUndefined();
  });

  it("serializes concurrent compile attempts into one immutable Manifest", async () => {
    if (pool === undefined) return;
    const store = new PostgresContextManifestStore(pool, () => now);
    const [left, right] = await Promise.all([
      store.compileInitialManifest({
        organizationId: orgId,
        runId,
        manifestId: `ctx_${ulid(92)}` as ContextManifestId,
        maxTokens: 16_000,
      }),
      store.compileInitialManifest({
        organizationId: orgId,
        runId,
        manifestId: `ctx_${ulid(93)}` as ContextManifestId,
        maxTokens: 16_000,
      }),
    ]);

    expect(left.id).toBe(right.id);
    expect(left.taskRevision).toBe(2);
    const persisted = await pool.query("SELECT count(*)::int AS count FROM aop.context_manifests WHERE organization_id=$1 AND run_id=$2", [orgId, runId]);
    expect(persisted.rows[0]?.count).toBe(1);
  });

  it("rejects reuse when the Task revision changes after Manifest compilation", async () => {
    if (pool === undefined) return;
    const store = new PostgresContextManifestStore(pool, () => now);
    const manifestId = `ctx_${ulid(99)}` as ContextManifestId;
    await store.compileInitialManifest({ organizationId: orgId, runId, manifestId, maxTokens: 16_000 });

    await pool.query(
      "UPDATE aop.tasks SET revision=revision+1, updated_at=$3 WHERE organization_id=$1 AND id=$2",
      [orgId, taskId, later],
    );

    await expect(
      store.compileInitialManifest({ organizationId: orgId, runId, manifestId, maxTokens: 16_000 }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  });

  it("rejects compilation when a required Artifact input becomes stale", async () => {
    if (pool === undefined) return;

    await pool.query(
      `INSERT INTO aop.artifact_versions (
         id, organization_id, artifact_id, version, status, created_by_type, created_by_id,
         content_uri, mime_type, checksum, size_bytes, supersedes_version_id,
         approved_by_type, approved_by_id, approved_at, created_at
       ) VALUES ($1,$2,$3,2,'approved','human',$4,$5,'text/markdown',$6,600,$7,'human',$4,$8,$8)`,
      [artifactV2, orgId, artifactId, ownerId, `aop://${orgId}/artifacts/${artifactId}/versions/${artifactV2}`, digest("2"), artifactV1, later],
    );
    await pool.query(
      "UPDATE aop.artifact_versions SET status='superseded' WHERE organization_id=$1 AND id=$2",
      [orgId, artifactV1],
    );
    await pool.query(
      "UPDATE aop.artifacts SET current_approved_version_id=$3, revision=2, updated_at=$4 WHERE organization_id=$1 AND id=$2",
      [orgId, artifactId, artifactV2, later],
    );

    const store = new PostgresContextManifestStore(pool, () => later);
    await expect(
      store.compileInitialManifest({
        organizationId: orgId,
        runId,
        manifestId: `ctx_${ulid(94)}` as ContextManifestId,
        maxTokens: 16_000,
      }),
    ).rejects.toMatchObject({ code: "invariant_violation" });

    expect(await store.getForRun(orgId, runId)).toBeUndefined();
  });

  it("rejects an execution identity with no active Role assignment", async () => {
    if (pool === undefined) return;
    await pool.query("DELETE FROM aop.role_assignments WHERE organization_id=$1 AND agent_id=$2", [orgId, agentId]);

    const store = new PostgresContextManifestStore(pool, () => now);
    await expect(
      store.compileInitialManifest({
        organizationId: orgId,
        runId,
        manifestId: `ctx_${ulid(95)}` as ContextManifestId,
        maxTokens: 16_000,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("fails rather than silently dropping mandatory truth when the budget is too small", async () => {
    if (pool === undefined) return;
    const store = new PostgresContextManifestStore(pool, () => now);

    await expect(
      store.compileInitialManifest({
        organizationId: orgId,
        runId,
        manifestId: `ctx_${ulid(96)}` as ContextManifestId,
        maxTokens: 1,
      }),
    ).rejects.toBeInstanceOf(ContextCompileError);
    expect(await store.getForRun(orgId, runId)).toBeUndefined();
  });

  it("defends the persistence boundary against a direct malformed Manifest insert", async () => {
    if (pool === undefined) return;
    const fragment = {
      key: "policy:only",
      kind: "policy",
      trust: "authoritative",
      mandatory: true,
      authorityWeight: 1,
      relevanceWeight: 1,
      tokenEstimate: 1,
      content: "{}",
      digest: `sha256:${"0".repeat(64)}`,
    };

    await expect(
      pool.query(
        `INSERT INTO aop.context_manifests (
           id, organization_id, task_id, run_id, agent_id, task_revision,
           fragments, total_token_estimate, compiled_at, schema_version, protocol_version
         ) VALUES ($1,$2,$3,$4,$5,2,$6::jsonb,1,$7,1,'0.1.0')`,
        [`ctx_${ulid(97)}`, orgId, taskId, runId, agentId, JSON.stringify([fragment]), now],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

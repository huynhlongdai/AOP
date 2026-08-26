import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  CommandGateway,
  TaskCreateHandler,
  semanticCommandDigest,
  type GatewayIds,
} from "@aop/command-bus";
import {
  AOP_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  type ApprovalRequestId,
  type CommandEnvelope,
  type CommandId,
  type EventId,
} from "@aop/protocol";

import { PostgresAuthorizationResolver } from "./postgres-command-store.js";
import { PostgresRuntimeCommandStore } from "./postgres-runtime-command-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(121)}`;
const otherOrgId = `org_${ulid(122)}`;
const humanId = `usr_${ulid(121)}`;
const ctoAgentId = `agt_${ulid(121)}`;
const ownerAgentId = `agt_${ulid(122)}`;
const reviewerAgentId = `agt_${ulid(123)}`;
const outsiderAgentId = `agt_${ulid(124)}`;
const goalId = `gol_${ulid(121)}`;
const otherGoalId = `gol_${ulid(122)}`;
const parentTaskId = `tsk_${ulid(121)}`;
const dependencyTaskId = `tsk_${ulid(122)}`;
const otherDependencyTaskId = `tsk_${ulid(123)}`;
const childTaskId = `tsk_${ulid(124)}`;
const staleVersionId = `arv_${ulid(121)}`;
const currentVersionId = `arv_${ulid(122)}`;
const artifactId = `art_${ulid(121)}`;
const otherArtifactId = `art_${ulid(122)}`;
const otherArtifactVersionId = `arv_${ulid(123)}`;
const now = "2026-08-26T03:50:00.000Z";
const earlier = "2026-08-26T03:40:00.000Z";
const checksum = (digit: string) => `sha256:${digit.repeat(64)}`;

function ids(): GatewayIds {
  let event = 12_100;
  let approval = 12_100;
  return {
    nextEventId: () => `evt_${ulid(++event)}` as EventId,
    nextApprovalRequestId: () => `apr_${ulid(++approval)}` as ApprovalRequestId,
  };
}

function gateway(): CommandGateway {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  return new CommandGateway({
    store: new PostgresRuntimeCommandStore(pool),
    authorization: new PostgresAuthorizationResolver(() => now),
    handlers: [new TaskCreateHandler(() => now)],
    ids: ids(),
    digest: semanticCommandDigest,
    now: () => now,
  });
}

function createCommand(
  suffix: number,
  changes: Partial<{
    taskId: string;
    ownerAgentId: string;
    reviewerAgentId: string;
    expectedRevision: number;
    artifactVersionId: string;
    dependencyTaskId: string;
    actorId: string;
  }> = {},
): CommandEnvelope {
  const taskId = changes.taskId ?? childTaskId;
  const owner = changes.ownerAgentId ?? ownerAgentId;
  const reviewer = changes.reviewerAgentId ?? reviewerAgentId;
  const artifactVersionId = changes.artifactVersionId ?? currentVersionId;
  const dependency = changes.dependencyTaskId ?? dependencyTaskId;
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(12_200 + suffix)}` as CommandId,
    type: "task.create",
    organizationId: orgId,
    actor: { type: "agent", id: changes.actorId ?? ctoAgentId },
    target: { type: "task", id: parentTaskId },
    expectedRevision: changes.expectedRevision ?? 2,
    idempotencyKey: `task.create.integration.${suffix}`,
    payload: {
      taskId,
      title: "Implement authentication API",
      objective: "Implement the bounded authentication API Work Contract",
      ownerAgentId: owner,
      reviewerAgentId: reviewer,
      priority: "high",
      scope: { includes: ["auth API"], excludes: ["production deploy"] },
      inputs: [{ artifactVersionId, required: true }],
      deliverables: [{ type: "code.patch", description: "Authentication implementation", required: true }],
      acceptanceCriteria: ["Automated tests pass", "QA review passes"],
      requiredCapabilities: ["backend"],
      constraints: { maxFiles: 12 },
      budget: { maxTokens: 8_000, maxToolCalls: 12 },
      dependencies: [{ taskId: dependency, type: "hard" }],
    },
    issuedAt: now,
  });
}

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.organizations WHERE id = ANY($1::text[])", [[orgId, otherOrgId]]);
  await pool.query("DELETE FROM aop.agents WHERE id = ANY($1::text[])", [
    [ctoAgentId, ownerAgentId, reviewerAgentId, outsiderAgentId],
  ]);
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");

  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES
       ($1,'Decomposition Org','company','active','Verify bounded agent decomposition','human',$3,'assistant_managed',0,$4,$4),
       ($2,'Other Org','company','active','Scope boundary fixture','human',$3,'human_managed',0,$4,$4)`,
    [orgId, otherOrgId, humanId, earlier],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES
       ($1,'CTO','0.1.0','Decomposes engineering work','["planning","task.create"]','{"adapter":"runtime.openai"}',0,$5,$5),
       ($2,'Backend','0.1.0','Implements backend work','["backend"]','{"adapter":"runtime.openai"}',0,$5,$5),
       ($3,'QA','0.1.0','Reviews engineering work','["qa"]','{"adapter":"runtime.openai"}',0,$5,$5),
       ($4,'Outsider','0.1.0','Other organization worker','["backend"]','{"adapter":"runtime.openai"}',0,$5,$5)`,
    [ctoAgentId, ownerAgentId, reviewerAgentId, outsiderAgentId, earlier],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision) VALUES
       ($1,$5,$6,'active',$9,0),
       ($2,$5,$7,'active',$9,0),
       ($3,$5,$8,'active',$9,0),
       ($4,$10,$11,'active',$9,0)`,
    [
      `mem_${ulid(121)}`,
      `mem_${ulid(122)}`,
      `mem_${ulid(123)}`,
      `mem_${ulid(124)}`,
      orgId,
      ctoAgentId,
      ownerAgentId,
      reviewerAgentId,
      earlier,
      otherOrgId,
      outsiderAgentId,
    ],
  );
  await pool.query(
    `INSERT INTO aop.roles (
       id, organization_id, name, purpose, responsibilities, authority, revision, created_at, updated_at
     ) VALUES
       ($1,$5,'CTO','Decompose engineering work','["Create bounded Work Contracts"]','{"allowedCapabilities":["task.create"],"approvalRequiredCapabilities":[],"deniedCapabilities":[]}',0,$7,$7),
       ($2,$5,'Backend','Implement backend','["Implement backend"]','{"allowedCapabilities":["task.submit_review"],"approvalRequiredCapabilities":[],"deniedCapabilities":[]}',0,$7,$7),
       ($3,$5,'QA','Review backend','["Review work"]','{"allowedCapabilities":["review.resolve"],"approvalRequiredCapabilities":[],"deniedCapabilities":[]}',0,$7,$7),
       ($4,$6,'Other Role','Other org role','["Implement"]','{"allowedCapabilities":[],"approvalRequiredCapabilities":[],"deniedCapabilities":[]}',0,$7,$7)`,
    [
      `rol_${ulid(121)}`,
      `rol_${ulid(122)}`,
      `rol_${ulid(123)}`,
      `rol_${ulid(124)}`,
      orgId,
      otherOrgId,
      earlier,
    ],
  );
  await pool.query(
    `INSERT INTO aop.role_assignments (organization_id, agent_id, role_id, active_from) VALUES
       ($1,$2,$3,$8),
       ($1,$4,$5,$8),
       ($1,$6,$7,$8),
       ($9,$10,$11,$8)`,
    [
      orgId,
      ctoAgentId,
      `rol_${ulid(121)}`,
      ownerAgentId,
      `rol_${ulid(122)}`,
      reviewerAgentId,
      `rol_${ulid(123)}`,
      earlier,
      otherOrgId,
      outsiderAgentId,
      `rol_${ulid(124)}`,
    ],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES
       ($1,$3,'Ship MVP','Produce a verified software MVP','human',$5,'["MVP accepted"]','critical','active',0,$6,$6),
       ($2,$4,'Other Goal','Other organization scope','human',$5,'["fixture"]','medium','active',0,$6,$6)`,
    [goalId, otherGoalId, orgId, otherOrgId, humanId, earlier],
  );
  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       owner_agent_id, reviewer_agent_id, priority, state, scope, deliverables,
       acceptance_criteria, required_capabilities, constraints, budget, revision,
       created_at, updated_at, completed_at
     ) VALUES
       ($1,$4,$5,'Decompose MVP','Create Backend and QA Work Contracts','human',$8,$9,$10,'critical','running',
        '{"includes":["engineering decomposition"],"excludes":["production deploy"]}',
        '[{"type":"work.plan","description":"Engineering task graph","required":true}]',
        '["Child Work Contracts are bounded"]','["task.create"]','{}','{"maxTokens":12000}',2,$11,$11,NULL),
       ($2,$4,$5,'Architecture prerequisite','Architecture dependency fixture','human',$8,$9,$10,'high','ready',
        '{"includes":["architecture"],"excludes":[]}',
        '[{"type":"architecture.spec","description":"Architecture","required":true}]',
        '["Architecture contract exists"]','[]','{}','{}',0,$11,$11,NULL),
       ($3,$6,$7,'Other dependency','Other org Task','human',$8,$12,NULL,'medium','ready',
        '{"includes":["other"],"excludes":[]}',
        '[{"type":"code.patch","description":"Other","required":true}]',
        '["Other"]','["backend"]','{}','{}',0,$11,$11,NULL)`,
    [
      parentTaskId,
      dependencyTaskId,
      otherDependencyTaskId,
      orgId,
      goalId,
      otherOrgId,
      otherGoalId,
      humanId,
      ctoAgentId,
      reviewerAgentId,
      earlier,
      outsiderAgentId,
    ],
  );

  await pool.query(
    `INSERT INTO aop.artifacts (
       id, organization_id, type, title, current_approved_version_id, revision, created_at, updated_at
     ) VALUES
       ($1,$3,'product.spec','MVP product contract',NULL,0,$5,$5),
       ($2,$4,'product.spec','Other product contract',NULL,0,$5,$5)`,
    [artifactId, otherArtifactId, orgId, otherOrgId, earlier],
  );
  await pool.query(
    `INSERT INTO aop.artifact_versions (
       id, organization_id, artifact_id, version, status, created_by_type, created_by_id,
       content_uri, mime_type, checksum, size_bytes, approved_by_type, approved_by_id, approved_at, created_at
     ) VALUES
       ($1,$4,$5,1,'superseded','human',$7,$8,'text/markdown',$9,100,'human',$7,$10,$10),
       ($2,$4,$5,2,'approved','human',$7,$11,'text/markdown',$12,120,'human',$7,$13,$13),
       ($3,$6,$14,1,'approved','human',$7,$15,'text/markdown',$16,100,'human',$7,$13,$13)`,
    [
      staleVersionId,
      currentVersionId,
      otherArtifactVersionId,
      orgId,
      artifactId,
      otherOrgId,
      humanId,
      `aop://${orgId}/artifacts/${artifactId}/versions/${staleVersionId}`,
      checksum("1"),
      earlier,
      `aop://${orgId}/artifacts/${artifactId}/versions/${currentVersionId}`,
      checksum("2"),
      now,
      otherArtifactId,
      `aop://${otherOrgId}/artifacts/${otherArtifactId}/versions/${otherArtifactVersionId}`,
      checksum("3"),
    ],
  );
  await pool.query(
    `UPDATE aop.artifacts SET current_approved_version_id = CASE id WHEN $1 THEN $2 ELSE $3 END,
                              revision = 1, updated_at = $4
      WHERE id = ANY($5::text[])`,
    [artifactId, currentVersionId, otherArtifactVersionId, now, [artifactId, otherArtifactId]],
  );

  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       resource_type, resource_id, conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES ($1,$2,'agent',$3,'task.create','allow','task',$4,'{}','human',$5,0,$6)`,
    [`per_${ulid(121)}`, orgId, ctoAgentId, parentTaskId, humanId, earlier],
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

describeDb("PostgreSQL bounded task.create decomposition", () => {
  it("creates one same-Goal child Work Contract with exact inputs, dependency and decomposition lineage", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    const command = createCommand(1);

    const first = await bus.execute(command);
    expect(first.ok).toBe(true);
    const replay = await bus.execute(command);
    expect(replay).toEqual(first);

    expect(
      (await pool.query(
        `SELECT goal_id, created_by_type, created_by_id, owner_agent_id, reviewer_agent_id,
                state, revision, required_capabilities, budget
           FROM aop.tasks WHERE organization_id = $1 AND id = $2`,
        [orgId, childTaskId],
      )).rows[0],
    ).toMatchObject({
      goal_id: goalId,
      created_by_type: "agent",
      created_by_id: ctoAgentId,
      owner_agent_id: ownerAgentId,
      reviewer_agent_id: reviewerAgentId,
      state: "ready",
      revision: "0",
      required_capabilities: ["backend"],
      budget: { maxTokens: 8000, maxToolCalls: 12 },
    });
    expect(
      (await pool.query(
        "SELECT artifact_version_id, required FROM aop.task_artifact_inputs WHERE organization_id=$1 AND task_id=$2",
        [orgId, childTaskId],
      )).rows,
    ).toEqual([{ artifact_version_id: currentVersionId, required: true }]);
    expect(
      (await pool.query(
        "SELECT depends_on_task_id, dependency_type FROM aop.task_dependencies WHERE organization_id=$1 AND task_id=$2",
        [orgId, childTaskId],
      )).rows,
    ).toEqual([{ depends_on_task_id: dependencyTaskId, dependency_type: "hard" }]);
    expect(
      (await pool.query(
        `SELECT parent_task_id, child_task_id, created_by_type, created_by_id
           FROM aop.task_decompositions WHERE organization_id=$1 AND child_task_id=$2`,
        [orgId, childTaskId],
      )).rows,
    ).toEqual([
      {
        parent_task_id: parentTaskId,
        child_task_id: childTaskId,
        created_by_type: "agent",
        created_by_id: ctoAgentId,
      },
    ]);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id=$1", [orgId])).rows[0]?.count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.outbox_events WHERE organization_id=$1", [orgId])).rows[0]?.count)).toBe(1);
  });

  it("rejects stale required Artifact input atomically", async () => {
    if (pool === undefined) return;
    const result = await gateway().execute(createCommand(2, { artifactVersionId: staleVersionId }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invariant_violation");
    expect(Number((await pool.query("SELECT count(*) FROM aop.tasks WHERE id=$1", [childTaskId])).rows[0]?.count)).toBe(0);
    expect(Number((await pool.query("SELECT count(*) FROM aop.task_decompositions WHERE child_task_id=$1", [childTaskId])).rows[0]?.count)).toBe(0);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id=$1", [orgId])).rows[0]?.count)).toBe(0);
  });

  it("rejects owner capability or active Role gaps before persisting the child", async () => {
    if (pool === undefined) return;
    const capabilityResult = await gateway().execute(createCommand(3, { ownerAgentId: ctoAgentId }));
    expect(capabilityResult.ok).toBe(false);
    if (!capabilityResult.ok) expect(capabilityResult.error.code).toBe("invariant_violation");

    await pool.query(
      "UPDATE aop.role_assignments SET active_until=$3 WHERE organization_id=$1 AND agent_id=$2",
      [orgId, ownerAgentId, earlier],
    );
    const roleResult = await gateway().execute(createCommand(4));
    expect(roleResult.ok).toBe(false);
    if (!roleResult.ok) expect(roleResult.error.code).toBe("invariant_violation");
    expect(Number((await pool.query("SELECT count(*) FROM aop.tasks WHERE id=$1", [childTaskId])).rows[0]?.count)).toBe(0);
  });

  it("rejects cross-Organization dependency and stale parent revision", async () => {
    if (pool === undefined) return;
    const scopeResult = await gateway().execute(createCommand(5, { dependencyTaskId: otherDependencyTaskId }));
    expect(scopeResult.ok).toBe(false);
    if (!scopeResult.ok) expect(scopeResult.error.code).toBe("scope_mismatch");

    const revisionResult = await gateway().execute(createCommand(6, { expectedRevision: 1 }));
    expect(revisionResult.ok).toBe(false);
    if (!revisionResult.ok) expect(revisionResult.error.code).toBe("revision_conflict");
    expect(Number((await pool.query("SELECT count(*) FROM aop.tasks WHERE id=$1", [childTaskId])).rows[0]?.count)).toBe(0);
  });
});
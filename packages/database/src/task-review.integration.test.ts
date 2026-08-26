import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  CommandGateway,
  ReviewResolveHandler,
  TaskRunFinishHandler,
  TaskSubmitReviewHandler,
  semanticCommandDigest,
  type GatewayIds,
} from "@aop/command-bus";
import {
  AOP_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  type ApprovalRequestId,
  type CommandEnvelope,
  type EventId,
} from "@aop/protocol";

import { PostgresAuthorizationResolver } from "./postgres-command-store.js";
import { PostgresRuntimeCommandStore } from "./postgres-runtime-command-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(61)}`;
const humanId = `usr_${ulid(61)}`;
const ownerAgentId = `agt_${ulid(61)}`;
const reviewerAgentId = `agt_${ulid(62)}`;
const goalId = `gol_${ulid(61)}`;
const taskId = `tsk_${ulid(61)}`;
const runId = `run_${ulid(61)}`;
const leaseId = `lea_${ulid(61)}`;
const reviewId = `rev_${ulid(61)}`;
const manifestId = `ctx_${ulid(61)}`;
const artifactId = `art_${ulid(61)}`;
const staleVersionId = `arv_${ulid(61)}`;
const currentVersionId = `arv_${ulid(62)}`;
const now = "2026-08-25T14:10:00.000Z";
const checksum = (digit: string) => `sha256:${digit.repeat(64)}`;

function ids(): GatewayIds {
  let event = 1_800;
  let approval = 1_800;
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
    handlers: [
      new TaskSubmitReviewHandler(() => now),
      new TaskRunFinishHandler(() => now),
      new ReviewResolveHandler(() => now),
    ],
    ids: ids(),
    digest: semanticCommandDigest,
    now: () => now,
  });
}

function submitCommand(suffix = 1): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(1_900 + suffix)}`,
    type: "task.submit_review",
    organizationId: orgId,
    actor: { type: "agent", id: ownerAgentId },
    target: { type: "task", id: taskId },
    expectedRevision: 0,
    idempotencyKey: `task.review.submit.${suffix}`,
    payload: {
      reviewId,
      criteria: [
        { key: "tests.pass", description: "Automated tests pass", required: true },
        { key: "contract.current", description: "Implementation uses current approved inputs", required: true },
      ],
    },
    issuedAt: now,
  });
}

function finishCommand(suffix: number): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(2_000 + suffix)}`,
    type: "task_run.finish",
    organizationId: orgId,
    actor: { type: "system", id: "runtime-manager" },
    target: { type: "task_run", id: runId },
    expectedRevision: 0,
    idempotencyKey: `task.review.runtime.finish.${suffix}`,
    payload: {
      taskExpectedRevision: 1,
      contextManifestId: manifestId,
      runtimeId: "runtime-review",
      adapter: "runtime.test",
      provider: "test-provider",
      model: "test-model",
      status: "succeeded",
      usage: { inputTokens: 100, outputTokens: 20, toolCalls: 1, costCredits: 0.1 },
      traceRefs: [{ provider: "test-provider", traceId: `review-run-${suffix}` }],
      commandOutcomes: [],
    },
    issuedAt: now,
  });
}

function resolveCommand(
  result: "pass" | "rework" | "fail",
  actorId = reviewerAgentId,
  suffix = 2,
): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(2_100 + suffix)}`,
    type: "review.resolve",
    organizationId: orgId,
    actor: { type: "agent", id: actorId },
    target: { type: "review", id: reviewId },
    expectedRevision: 0,
    idempotencyKey: `task.review.resolve.${result}.${actorId}.${suffix}`,
    payload: {
      taskExpectedRevision: 1,
      result,
      evidence: result === "pass" ? [{ type: "task_run", id: runId }] : [],
      findings: result === "pass" ? [] : [`QA requested ${result}`],
    },
    issuedAt: now,
  });
}

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.leases WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM aop.task_runs WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [orgId]);
  await pool.query("DELETE FROM aop.agents WHERE id = ANY($1::text[])", [[ownerAgentId, reviewerAgentId]]);
}

function manifestFragments(): readonly Record<string, unknown>[] {
  const kinds = ["policy", "identity", "role", "authority", "goal", "task", "output_contract"] as const;
  return kinds.map((kind, index) => ({
    key: `${kind}:${index}`,
    kind,
    trust: "authoritative",
    mandatory: true,
    authorityWeight: 1,
    relevanceWeight: 1,
    tokenEstimate: 1,
    content: JSON.stringify({ kind }),
    digest: checksum(String((index % 9) + 1)),
  }));
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES ($1,'QA Review Org','company','active','Verify work before completion','human',$2,'human_managed',0,$3,$3)`,
    [orgId, humanId, now],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES
       ($1,'Backend Worker','0.1.0','Produces implementation','["backend"]','{"adapter":"runtime.test"}',0,$3,$3),
       ($2,'QA Reviewer','0.1.0','Verifies implementation','["qa"]','{"adapter":"runtime.test"}',0,$3,$3)`,
    [ownerAgentId, reviewerAgentId, now],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision) VALUES
       ($1,$3,$4,'active',$5,0),
       ($2,$3,$6,'active',$5,0)`,
    [`mem_${ulid(61)}`, `mem_${ulid(62)}`, orgId, ownerAgentId, now, reviewerAgentId],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Ship verified work','Require independent QA','human',$3,'["review pass"]','critical','active',0,$4,$4)`,
    [goalId, orgId, humanId, now],
  );
  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       owner_agent_id, reviewer_agent_id, priority, state, scope, deliverables,
       acceptance_criteria, required_capabilities, constraints, budget, revision, created_at, updated_at
     ) VALUES ($1,$2,$3,'Implement auth API','Deliver reviewed backend work','human',$4,$5,$6,'high','running',
       '{"includes":["auth"],"excludes":[]}',
       '[{"type":"code.patch","description":"implementation","required":true}]',
       '["tests pass","review pass"]','["backend"]','{}','{}',0,$7,$7)`,
    [taskId, orgId, goalId, humanId, ownerAgentId, reviewerAgentId, now],
  );
  await pool.query(
    `INSERT INTO aop.task_runs (
       id, organization_id, task_id, agent_id, attempt, status, runtime_type,
       runtime_id, workspace_id, started_at, heartbeat_at, revision
     ) VALUES ($1,$2,$3,$4,1,'running','runtime.test','runtime-review','workspace-review',$5,$5,0)`,
    [runId, orgId, taskId, ownerAgentId, now],
  );
  const fragments = manifestFragments();
  await pool.query(
    `INSERT INTO aop.context_manifests (
       id, organization_id, task_id, run_id, agent_id, task_revision,
       schema_version, protocol_version, fragments, total_token_estimate, compiled_at
     ) VALUES ($1,$2,$3,$4,$5,0,1,'0.1.0',$6::jsonb,$7,$8)`,
    [manifestId, orgId, taskId, runId, ownerAgentId, JSON.stringify(fragments), fragments.length, now],
  );
  await pool.query(
    `INSERT INTO aop.leases (
       id, organization_id, task_id, run_id, agent_id, status, attempt,
       acquired_at, expires_at, heartbeat_interval_seconds, revision
     ) VALUES ($1,$2,$3,$4,$5,'active',1,$6,$7,30,0)`,
    [leaseId, orgId, taskId, runId, ownerAgentId, now, "2026-08-25T14:15:00.000Z"],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES
       ($1,$6,'agent',$7,'task.submit_review','allow','{}','human',$9,0,$10),
       ($2,$6,'agent',$8,'review.resolve','allow','{}','human',$9,0,$10),
       ($3,$6,'agent',$7,'review.resolve','allow','{}','human',$9,0,$10),
       ($4,$6,'human',$9,'review.resolve','allow','{}','human',$9,0,$10),
       ($5,$6,'system','runtime-manager','task_run.finish','allow','{}','human',$9,0,$10)`,
    [
      `per_${ulid(61)}`,
      `per_${ulid(62)}`,
      `per_${ulid(63)}`,
      `per_${ulid(64)}`,
      `per_${ulid(65)}`,
      orgId,
      ownerAgentId,
      reviewerAgentId,
      humanId,
      now,
    ],
  );
}

async function addStaleRequiredInput(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO aop.artifacts (
         id, organization_id, type, title, current_approved_version_id, revision, created_at, updated_at
       ) VALUES ($1,$2,'api.spec','Authentication contract',NULL,0,$3,$3)`,
      [artifactId, orgId, now],
    );
    await client.query(
      `INSERT INTO aop.artifact_versions (
         id, organization_id, artifact_id, version, status, created_by_type, created_by_id,
         content_uri, mime_type, checksum, size_bytes, approved_by_type, approved_by_id, approved_at, created_at
       ) VALUES
         ($1,$3,$4,1,'superseded','agent',$5,$6,'application/json',$7,100,'agent',$8,$9,$9),
         ($2,$3,$4,2,'approved','agent',$5,$10,'application/json',$11,120,'agent',$8,$9,$9)`,
      [
        staleVersionId,
        currentVersionId,
        orgId,
        artifactId,
        ownerAgentId,
        `aop://${orgId}/artifacts/${artifactId}/versions/${staleVersionId}`,
        checksum("1"),
        reviewerAgentId,
        now,
        `aop://${orgId}/artifacts/${artifactId}/versions/${currentVersionId}`,
        checksum("2"),
      ],
    );
    await client.query(
      `UPDATE aop.artifacts
          SET current_approved_version_id = $3, revision = 1, updated_at = $4
        WHERE organization_id = $1 AND id = $2`,
      [orgId, artifactId, currentVersionId, now],
    );
    await client.query(
      `INSERT INTO aop.task_artifact_inputs (organization_id, task_id, artifact_version_id, required, created_at)
       VALUES ($1,$2,$3,true,$4)`,
      [orgId, taskId, staleVersionId, now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await pool?.end();
});

describeDb("PostgreSQL Task QA review/rework lifecycle", () => {
  it("requires Runtime finish evidence before independent Review resolution", async () => {
    if (pool === undefined) return;
    const bus = gateway();

    expect((await bus.execute(submitCommand())).ok).toBe(true);
    expect((await pool.query("SELECT state, revision FROM aop.tasks WHERE id = $1", [taskId])).rows[0]).toEqual({
      state: "review",
      revision: "1",
    });
    expect((await pool.query("SELECT status, revision FROM aop.task_runs WHERE id = $1", [runId])).rows[0]).toEqual({
      status: "running",
      revision: "0",
    });
    expect((await pool.query("SELECT status, revision FROM aop.leases WHERE id = $1", [leaseId])).rows[0]).toEqual({
      status: "active",
      revision: "0",
    });

    const earlyReview = await bus.execute(resolveCommand("pass", reviewerAgentId, 2));
    expect(earlyReview.ok).toBe(false);
    if (!earlyReview.ok) expect(earlyReview.error.code).toBe("invariant_violation");

    expect((await bus.execute(finishCommand(3))).ok).toBe(true);
    expect((await pool.query("SELECT status, revision FROM aop.task_runs WHERE id = $1", [runId])).rows[0]).toEqual({
      status: "succeeded",
      revision: "1",
    });
    expect((await pool.query("SELECT status, revision FROM aop.leases WHERE id = $1", [leaseId])).rows[0]).toEqual({
      status: "released",
      revision: "1",
    });
    expect((await pool.query("SELECT count(*)::int AS count FROM aop.runtime_run_reports WHERE run_id = $1", [runId])).rows[0])
      .toEqual({ count: 1 });

    expect((await bus.execute(resolveCommand("pass", reviewerAgentId, 4))).ok).toBe(true);
    expect(
      (await pool.query("SELECT state, revision, completed_at IS NOT NULL AS completed FROM aop.tasks WHERE id = $1", [taskId]))
        .rows[0],
    ).toEqual({ state: "completed", revision: "2", completed: true });
    expect(
      (await pool.query("SELECT result, revision, jsonb_array_length(evidence) AS evidence_count FROM aop.reviews WHERE id = $1", [reviewId]))
        .rows[0],
    ).toEqual({ result: "pass", revision: "1", evidence_count: 1 });

    const events = await pool.query(
      `SELECT type FROM aop.events WHERE organization_id = $1 ORDER BY organization_sequence`,
      [orgId],
    );
    expect(events.rows.map((row) => row.type)).toEqual([
      "task.review_submitted",
      "review.created",
      "task_run.succeeded",
      "lease.released",
      "review.resolved",
      "task.completed",
    ]);
    expect((await pool.query("SELECT count(*)::int AS count FROM aop.outbox_events WHERE organization_id = $1", [orgId])).rows[0])
      .toEqual({ count: 6 });
  });

  it("returns review rework to READY only after Runtime execution is closed", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    expect((await bus.execute(submitCommand(10))).ok).toBe(true);
    expect((await bus.execute(finishCommand(11))).ok).toBe(true);
    expect((await bus.execute(resolveCommand("rework", reviewerAgentId, 12))).ok).toBe(true);

    expect(
      (await pool.query("SELECT state, revision, completed_at FROM aop.tasks WHERE id = $1", [taskId])).rows[0],
    ).toEqual({ state: "ready", revision: "2", completed_at: null });
    expect((await pool.query("SELECT result, findings FROM aop.reviews WHERE id = $1", [reviewId])).rows[0]).toEqual({
      result: "rework",
      findings: ["QA requested rework"],
    });
    expect((await pool.query("SELECT count(*)::int AS count FROM aop.leases WHERE organization_id = $1 AND status = 'active'", [orgId])).rows[0])
      .toEqual({ count: 0 });
  });

  it("rejects a privileged non-reviewer and keeps the Review pending", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    expect((await bus.execute(submitCommand(20))).ok).toBe(true);
    expect((await bus.execute(finishCommand(21))).ok).toBe(true);

    const result = await bus.execute(resolveCommand("pass", ownerAgentId, 22));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
    expect((await pool.query("SELECT result, revision FROM aop.reviews WHERE id = $1", [reviewId])).rows[0]).toEqual({
      result: "pending",
      revision: "0",
    });
    expect((await pool.query("SELECT state, revision FROM aop.tasks WHERE id = $1", [taskId])).rows[0]).toEqual({
      state: "review",
      revision: "1",
    });
  });

  it("blocks PASS and direct SQL completion when a required input becomes stale during review", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    expect((await bus.execute(submitCommand(30))).ok).toBe(true);
    expect((await bus.execute(finishCommand(31))).ok).toBe(true);
    await addStaleRequiredInput();

    const result = await bus.execute(resolveCommand("pass", reviewerAgentId, 32));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invariant_violation");
    expect((await pool.query("SELECT result FROM aop.reviews WHERE id = $1", [reviewId])).rows[0]).toEqual({ result: "pending" });
    expect((await pool.query("SELECT state FROM aop.tasks WHERE id = $1", [taskId])).rows[0]).toEqual({ state: "review" });

    await expect(
      pool.query(
        `UPDATE aop.tasks
            SET state = 'completed', completed_at = $3, revision = revision + 1
          WHERE organization_id = $1 AND id = $2`,
        [orgId, taskId, now],
      ),
    ).rejects.toThrow(/stale required Artifact inputs/);
  });
});

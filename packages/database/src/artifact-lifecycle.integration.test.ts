import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  ArtifactApproveHandler,
  ArtifactCreateHandler,
  ArtifactRejectHandler,
  ArtifactReviseHandler,
  ArtifactSubmitReviewHandler,
  CommandGateway,
  semanticCommandDigest,
  type GatewayIds,
} from "@aop/command-bus";
import {
  AOP_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  type ApprovalRequestId,
  type CommandEnvelope,
  type EventId,
  type Principal,
} from "@aop/protocol";

import { PostgresAuthorizationResolver, PostgresCommandStore } from "./postgres-command-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(41)}`;
const ownerId = `usr_${ulid(41)}`;
const agentId = `agt_${ulid(41)}`;
const membershipId = `mem_${ulid(41)}`;
const goalId = `gol_${ulid(41)}`;
const taskId = `tsk_${ulid(41)}`;
const artifactId = `art_${ulid(41)}`;
const versionOneId = `arv_${ulid(41)}`;
const versionTwoId = `arv_${ulid(42)}`;
const now = "2026-08-25T12:00:00.000Z";
const checksum = (digit: string) => `sha256:${digit.repeat(64)}`;

function ids(): GatewayIds {
  let event = 1_100;
  let approval = 1_100;
  return {
    nextEventId: () => `evt_${ulid(++event)}` as EventId,
    nextApprovalRequestId: () => `apr_${ulid(++approval)}` as ApprovalRequestId,
  };
}

function gateway(): CommandGateway {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  return new CommandGateway({
    store: new PostgresCommandStore(pool),
    authorization: new PostgresAuthorizationResolver(() => now),
    handlers: [
      new ArtifactCreateHandler(() => now),
      new ArtifactReviseHandler(() => now),
      new ArtifactSubmitReviewHandler(() => now),
      new ArtifactApproveHandler(() => now),
      new ArtifactRejectHandler(() => now),
    ],
    ids: ids(),
    digest: semanticCommandDigest,
    now: () => now,
  });
}

function createCommand(suffix: number): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(1_200 + suffix)}`,
    type: "artifact.create",
    organizationId: orgId,
    actor: { type: "agent", id: agentId },
    idempotencyKey: `artifact.lifecycle.create.${suffix}`,
    payload: {
      artifactId,
      versionId: versionOneId,
      type: "api.spec",
      title: "Authentication API contract",
      content: {
        uri: `aop://${orgId}/artifacts/${artifactId}/versions/${versionOneId}`,
        mimeType: "application/json",
        checksum: checksum("1"),
        sizeBytes: 100,
      },
      producedByTaskId: taskId,
      deliverableType: "api.spec",
      derivedFromVersionIds: [],
    },
    issuedAt: now,
  });
}

function reviseCommand(suffix: number, expectedRevision: number): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(1_300 + suffix)}`,
    type: "artifact.revise",
    organizationId: orgId,
    actor: { type: "agent", id: agentId },
    target: { type: "artifact", id: artifactId },
    expectedRevision,
    idempotencyKey: `artifact.lifecycle.revise.${suffix}`,
    payload: {
      versionId: versionTwoId,
      content: {
        uri: `aop://${orgId}/artifacts/${artifactId}/versions/${versionTwoId}`,
        mimeType: "application/json",
        checksum: checksum("2"),
        sizeBytes: 120,
      },
      producedByTaskId: taskId,
      deliverableType: "api.spec",
      derivedFromVersionIds: [versionOneId],
    },
    issuedAt: now,
  });
}

function lifecycleCommand(
  type: "artifact.submit_review" | "artifact.approve" | "artifact.reject",
  versionId: string,
  expectedRevision: number,
  suffix: number,
  actor: Principal,
): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(1_400 + suffix)}`,
    type,
    organizationId: orgId,
    actor,
    target: { type: "artifact", id: artifactId },
    expectedRevision,
    idempotencyKey: `artifact.lifecycle.${type}.${suffix}`,
    payload: { versionId },
    issuedAt: now,
  });
}

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [orgId]);
  await pool.query("DELETE FROM aop.agents WHERE id = $1", [agentId]);
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES ($1,'Artifact Lifecycle','company','active','Validate Artifact authority','human',$2,'human_managed',0,$3,$3)`,
    [orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES ($1,'Contract Worker','0.1.0','Produces API contracts','["backend"]','{"adapter":"runtime.test"}',0,$2,$2)`,
    [agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision)
     VALUES ($1,$2,$3,'active',$4,0)`,
    [membershipId, orgId, agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Approve contract','Publish an authoritative API contract','human',$3,'["approved contract"]','high','active',0,$4,$4)`,
    [goalId, orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       owner_agent_id, priority, state, scope, deliverables, acceptance_criteria,
       required_capabilities, constraints, budget, revision, created_at, updated_at
     ) VALUES ($1,$2,$3,'Produce API contract','Create versioned API contract','human',$4,$5,'high','running',
       '{"includes":["api"],"excludes":[]}',
       '[{"type":"api.spec","description":"contract","required":true}]',
       '["approved"]','["backend"]','{}','{}',0,$6,$6)`,
    [taskId, orgId, goalId, ownerId, agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES
       ($1,$6,'agent',$7,'artifact.create','allow','{}','human',$8,0,$9),
       ($2,$6,'agent',$7,'artifact.revise','allow','{}','human',$8,0,$9),
       ($3,$6,'agent',$7,'artifact.submit_review','allow','{}','human',$8,0,$9),
       ($4,$6,'agent',$7,'artifact.reject','allow','{}','human',$8,0,$9),
       ($5,$6,'human',$8,'artifact.approve','allow','{}','human',$8,0,$9)`,
    [
      `per_${ulid(41)}`,
      `per_${ulid(42)}`,
      `per_${ulid(43)}`,
      `per_${ulid(44)}`,
      `per_${ulid(45)}`,
      orgId,
      agentId,
      ownerId,
      now,
    ],
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

describeDb("PostgreSQL Artifact review/approval lifecycle", () => {
  it("moves latest draft through review to approved authoritative version", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    expect((await bus.execute(createCommand(1))).ok).toBe(true);
    expect(
      (
        await bus.execute(
          lifecycleCommand("artifact.submit_review", versionOneId, 0, 2, { type: "agent", id: agentId }),
        )
      ).ok,
    ).toBe(true);

    const unauthorized = await bus.execute(
      lifecycleCommand("artifact.approve", versionOneId, 1, 3, { type: "agent", id: agentId }),
    );
    expect(unauthorized.ok).toBe(false);
    if (!unauthorized.ok) expect(unauthorized.error.code).toBe("forbidden");

    const approved = await bus.execute(
      lifecycleCommand("artifact.approve", versionOneId, 1, 4, { type: "human", id: ownerId }),
    );
    expect(approved.ok).toBe(true);

    expect(
      (await pool.query("SELECT current_approved_version_id, revision FROM aop.artifacts WHERE id = $1", [artifactId]))
        .rows[0],
    ).toEqual({ current_approved_version_id: versionOneId, revision: "2" });
    expect(
      (
        await pool.query(
          "SELECT status, approved_by_type, approved_by_id, approved_at IS NOT NULL AS has_approved_at FROM aop.artifact_versions WHERE id = $1",
          [versionOneId],
        )
      ).rows[0],
    ).toEqual({ status: "approved", approved_by_type: "human", approved_by_id: ownerId, has_approved_at: true });
  });

  it("approving a later version supersedes prior approved truth while preserving its approval history", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    expect((await bus.execute(createCommand(10))).ok).toBe(true);
    expect(
      (
        await bus.execute(
          lifecycleCommand("artifact.submit_review", versionOneId, 0, 11, { type: "agent", id: agentId }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await bus.execute(
          lifecycleCommand("artifact.approve", versionOneId, 1, 12, { type: "human", id: ownerId }),
        )
      ).ok,
    ).toBe(true);
    expect((await bus.execute(reviseCommand(13, 2))).ok).toBe(true);
    expect(
      (
        await bus.execute(
          lifecycleCommand("artifact.submit_review", versionTwoId, 3, 14, { type: "agent", id: agentId }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await bus.execute(
          lifecycleCommand("artifact.approve", versionTwoId, 4, 15, { type: "human", id: ownerId }),
        )
      ).ok,
    ).toBe(true);

    expect(
      (await pool.query("SELECT current_approved_version_id, revision FROM aop.artifacts WHERE id = $1", [artifactId]))
        .rows[0],
    ).toEqual({ current_approved_version_id: versionTwoId, revision: "5" });
    const versions = await pool.query(
      `SELECT id, status, checksum, approved_by_id, approved_at IS NOT NULL AS has_approved_at
         FROM aop.artifact_versions WHERE artifact_id = $1 ORDER BY version`,
      [artifactId],
    );
    expect(versions.rows).toEqual([
      {
        id: versionOneId,
        status: "superseded",
        checksum: checksum("1"),
        approved_by_id: ownerId,
        has_approved_at: true,
      },
      {
        id: versionTwoId,
        status: "approved",
        checksum: checksum("2"),
        approved_by_id: ownerId,
        has_approved_at: true,
      },
    ]);
  });

  it("rejects latest in-review version without replacing the previous approved truth", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    expect((await bus.execute(createCommand(20))).ok).toBe(true);
    expect(
      (
        await bus.execute(
          lifecycleCommand("artifact.submit_review", versionOneId, 0, 21, { type: "agent", id: agentId }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await bus.execute(
          lifecycleCommand("artifact.approve", versionOneId, 1, 22, { type: "human", id: ownerId }),
        )
      ).ok,
    ).toBe(true);
    expect((await bus.execute(reviseCommand(23, 2))).ok).toBe(true);
    expect(
      (
        await bus.execute(
          lifecycleCommand("artifact.submit_review", versionTwoId, 3, 24, { type: "agent", id: agentId }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await bus.execute(
          lifecycleCommand("artifact.reject", versionTwoId, 4, 25, { type: "agent", id: agentId }),
        )
      ).ok,
    ).toBe(true);

    expect(
      (await pool.query("SELECT current_approved_version_id, revision FROM aop.artifacts WHERE id = $1", [artifactId]))
        .rows[0],
    ).toEqual({ current_approved_version_id: versionOneId, revision: "5" });
    expect((await pool.query("SELECT status FROM aop.artifact_versions WHERE id = $1", [versionTwoId])).rows[0]).toEqual({
      status: "rejected",
    });
  });

  it("refuses lifecycle actions against a stale non-latest ArtifactVersion", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    expect((await bus.execute(createCommand(30))).ok).toBe(true);
    expect((await bus.execute(reviseCommand(31, 0))).ok).toBe(true);

    const stale = await bus.execute(
      lifecycleCommand("artifact.submit_review", versionOneId, 1, 32, { type: "agent", id: agentId }),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("revision_conflict");
    expect((await pool.query("SELECT revision FROM aop.artifacts WHERE id = $1", [artifactId])).rows[0]?.revision).toBe("1");
    expect((await pool.query("SELECT status FROM aop.artifact_versions WHERE id = $1", [versionOneId])).rows[0]).toEqual({
      status: "draft",
    });
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  ArtifactApproveHandler,
  ArtifactCreateHandler,
  ArtifactReviseHandler,
  ArtifactSubmitReviewHandler,
  CommandGateway,
  TaskClaimHandler,
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

import { PostgresTaskArtifactInputStatusStore } from "./artifact-input-status-store.js";
import { PostgresAuthorizationResolver, PostgresCommandStore } from "./postgres-command-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(51)}`;
const ownerId = `usr_${ulid(51)}`;
const agentId = `agt_${ulid(51)}`;
const membershipId = `mem_${ulid(51)}`;
const goalId = `gol_${ulid(51)}`;
const producerTaskId = `tsk_${ulid(51)}`;
const consumerTaskId = `tsk_${ulid(52)}`;
const artifactId = `art_${ulid(51)}`;
const versionOneId = `arv_${ulid(51)}`;
const versionTwoId = `arv_${ulid(52)}`;
const runId = `run_${ulid(51)}`;
const leaseId = `lea_${ulid(51)}`;
const now = "2026-08-25T13:00:00.000Z";
const checksum = (digit: string) => `sha256:${digit.repeat(64)}`;

function ids(): GatewayIds {
  let event = 1_600;
  let approval = 1_600;
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
      new TaskClaimHandler(() => now),
    ],
    ids: ids(),
    digest: semanticCommandDigest,
    now: () => now,
  });
}

function createArtifactCommand(): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(1_700)}`,
    type: "artifact.create",
    organizationId: orgId,
    actor: { type: "agent", id: agentId },
    idempotencyKey: "artifact.invalidation.create",
    payload: {
      artifactId,
      versionId: versionOneId,
      type: "api.spec",
      title: "Consumer contract",
      content: {
        uri: `aop://${orgId}/artifacts/${artifactId}/versions/${versionOneId}`,
        mimeType: "application/json",
        checksum: checksum("1"),
        sizeBytes: 100,
      },
      producedByTaskId: producerTaskId,
      deliverableType: "api.spec",
      derivedFromVersionIds: [],
    },
    issuedAt: now,
  });
}

function reviseArtifactCommand(): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(1_704)}`,
    type: "artifact.revise",
    organizationId: orgId,
    actor: { type: "agent", id: agentId },
    target: { type: "artifact", id: artifactId },
    expectedRevision: 2,
    idempotencyKey: "artifact.invalidation.revise",
    payload: {
      versionId: versionTwoId,
      content: {
        uri: `aop://${orgId}/artifacts/${artifactId}/versions/${versionTwoId}`,
        mimeType: "application/json",
        checksum: checksum("2"),
        sizeBytes: 120,
      },
      producedByTaskId: producerTaskId,
      deliverableType: "api.spec",
      derivedFromVersionIds: [versionOneId],
    },
    issuedAt: now,
  });
}

function lifecycleCommand(
  versionId: string,
  expectedRevision: number,
  suffix: number,
  type: "artifact.submit_review" | "artifact.approve",
  actor: Principal,
): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(1_700 + suffix)}`,
    type,
    organizationId: orgId,
    actor,
    target: { type: "artifact", id: artifactId },
    expectedRevision,
    idempotencyKey: `artifact.invalidation.${type}.${suffix}`,
    payload: { versionId },
    issuedAt: now,
  });
}

function claimCommand(): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(1_710)}`,
    type: "task.claim",
    organizationId: orgId,
    actor: { type: "agent", id: agentId },
    target: { type: "task", id: consumerTaskId },
    expectedRevision: 0,
    idempotencyKey: "artifact.invalidation.claim",
    payload: {
      agentId,
      runId,
      leaseId,
      attempt: 1,
      runtimeType: "runtime.test",
      workspaceId: "workspace-consumer",
      leaseSeconds: 300,
      heartbeatIntervalSeconds: 30,
    },
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
     ) VALUES ($1,'Artifact Consumers','company','active','Validate stale consumer protection','human',$2,'human_managed',0,$3,$3)`,
    [orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES ($1,'Consumer Worker','0.1.0','Consumes API contracts','["backend"]','{"adapter":"runtime.test"}',0,$2,$2)`,
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
     ) VALUES ($1,$2,'Protect consumers','Prevent stale work','human',$3,'["stale work blocked"]','critical','active',0,$4,$4)`,
    [goalId, orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       owner_agent_id, priority, state, scope, deliverables, acceptance_criteria,
       required_capabilities, constraints, budget, revision, created_at, updated_at
     ) VALUES
       ($1,$3,$4,'Produce contract','Produce API spec','human',$5,$6,'high','running',
        '{"includes":["api"],"excludes":[]}',
        '[{"type":"api.spec","description":"contract","required":true}]',
        '["approved contract"]','["backend"]','{}','{}',0,$7,$7),
       ($2,$3,$4,'Implement consumer','Build against approved API spec','human',$5,NULL,'high','ready',
        '{"includes":["consumer"],"excludes":[]}',
        '[{"type":"code.patch","description":"consumer","required":true}]',
        '["uses current contract"]','["backend"]','{}','{}',0,$7,$7)`,
    [producerTaskId, consumerTaskId, orgId, goalId, ownerId, agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES
       ($1,$7,'agent',$8,'artifact.create','allow','{}','human',$9,0,$10),
       ($2,$7,'agent',$8,'artifact.revise','allow','{}','human',$9,0,$10),
       ($3,$7,'agent',$8,'artifact.submit_review','allow','{}','human',$9,0,$10),
       ($4,$7,'human',$9,'artifact.approve','allow','{}','human',$9,0,$10),
       ($5,$7,'agent',$8,'task.claim','allow','{}','human',$9,0,$10),
       ($6,$7,'human',$9,'task.claim','allow','{}','human',$9,0,$10)`,
    [
      `per_${ulid(51)}`,
      `per_${ulid(52)}`,
      `per_${ulid(53)}`,
      `per_${ulid(54)}`,
      `per_${ulid(55)}`,
      `per_${ulid(56)}`,
      orgId,
      agentId,
      ownerId,
      now,
    ],
  );
}

async function approveV1AndPinConsumer(bus: CommandGateway): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  expect((await bus.execute(createArtifactCommand())).ok).toBe(true);
  expect(
    (
      await bus.execute(
        lifecycleCommand(versionOneId, 0, 1, "artifact.submit_review", { type: "agent", id: agentId }),
      )
    ).ok,
  ).toBe(true);
  expect(
    (
      await bus.execute(lifecycleCommand(versionOneId, 1, 2, "artifact.approve", { type: "human", id: ownerId }))
    ).ok,
  ).toBe(true);
  await pool.query(
    `INSERT INTO aop.task_artifact_inputs (
       organization_id, task_id, artifact_version_id, required, created_at
     ) VALUES ($1,$2,$3,true,$4)`,
    [orgId, consumerTaskId, versionOneId, now],
  );
}

async function approveV2(bus: CommandGateway): Promise<void> {
  expect((await bus.execute(reviseArtifactCommand())).ok).toBe(true);
  expect(
    (
      await bus.execute(
        lifecycleCommand(versionTwoId, 3, 5, "artifact.submit_review", { type: "agent", id: agentId }),
      )
    ).ok,
  ).toBe(true);
  expect(
    (
      await bus.execute(lifecycleCommand(versionTwoId, 4, 6, "artifact.approve", { type: "human", id: ownerId }))
    ).ok,
  ).toBe(true);
}

beforeEach(async () => {
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await pool?.end();
});

describeDb("PostgreSQL Artifact consumer invalidation", () => {
  it("derives stale consumer metadata and emits an authoritative invalidation event", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    await approveV1AndPinConsumer(bus);

    const statusStore = new PostgresTaskArtifactInputStatusStore(pool);
    expect(await statusStore.listTaskInputs(orgId, consumerTaskId)).toEqual([
      { artifactId, versionId: versionOneId, required: true },
    ]);

    await approveV2(bus);

    expect(await statusStore.listTaskInputs(orgId, consumerTaskId)).toEqual([
      {
        artifactId,
        versionId: versionOneId,
        required: true,
        invalidatedByVersionId: versionTwoId,
        invalidatedAt: now,
      },
    ]);
    expect(await statusStore.listStaleRequiredVersions(orgId, consumerTaskId)).toEqual([versionOneId]);

    const event = await pool.query(
      `SELECT payload
         FROM aop.events
        WHERE organization_id = $1 AND type = 'artifact.consumers_invalidated'`,
      [orgId],
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]?.payload).toMatchObject({
      supersededVersionId: versionOneId,
      replacementVersionId: versionTwoId,
      conservativePolicy: true,
      impactSource: "derived_projection",
    });
    const outbox = await pool.query(
      `SELECT count(*)
         FROM aop.outbox_events oe
         JOIN aop.events e ON e.organization_id = oe.organization_id AND e.id = oe.event_id
        WHERE e.organization_id = $1 AND e.type = 'artifact.consumers_invalidated'`,
      [orgId],
    );
    expect(Number(outbox.rows[0]?.count)).toBe(1);
  });

  it("rejects a direct task.claim after its required Artifact input becomes stale", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    await approveV1AndPinConsumer(bus);
    await approveV2(bus);

    const claim = await bus.execute(claimCommand());
    expect(claim.ok).toBe(false);
    expect(Number((await pool.query("SELECT count(*) FROM aop.task_runs WHERE id = $1", [runId])).rows[0]?.count)).toBe(0);
    expect(Number((await pool.query("SELECT count(*) FROM aop.leases WHERE id = $1", [leaseId])).rows[0]?.count)).toBe(0);
    expect((await pool.query("SELECT state, revision FROM aop.tasks WHERE id = $1", [consumerTaskId])).rows[0]).toEqual({
      state: "ready",
      revision: "0",
    });
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  ArtifactCreateHandler,
  ArtifactReviseHandler,
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
} from "@aop/protocol";

import { PostgresAuthorizationResolver, PostgresCommandStore } from "./postgres-command-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(31)}`;
const userId = `usr_${ulid(31)}`;
const agentId = `agt_${ulid(31)}`;
const membershipId = `mem_${ulid(31)}`;
const goalId = `gol_${ulid(31)}`;
const taskId = `tsk_${ulid(31)}`;
const artifactId = `art_${ulid(31)}`;
const artifactIdTwo = `art_${ulid(32)}`;
const versionOneId = `arv_${ulid(31)}`;
const versionTwoId = `arv_${ulid(32)}`;
const versionThreeId = `arv_${ulid(33)}`;
const versionFourId = `arv_${ulid(34)}`;
const missingVersionId = `arv_${ulid(99)}`;
const now = "2026-08-25T10:00:00.000Z";
const checksum = (digit: string) => `sha256:${digit.repeat(64)}`;

function ids(): GatewayIds {
  let event = 700;
  let approval = 700;
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
    handlers: [new ArtifactCreateHandler(() => now), new ArtifactReviseHandler(() => now)],
    ids: ids(),
    digest: semanticCommandDigest,
    now: () => now,
  });
}

function createCommand(
  artifact: string,
  version: string,
  suffix: number,
  derivedFromVersionIds: readonly string[] = [],
): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(800 + suffix)}`,
    type: "artifact.create",
    organizationId: orgId,
    actor: { type: "agent", id: agentId },
    idempotencyKey: `artifact.create.test.${suffix}`,
    payload: {
      artifactId: artifact,
      versionId: version,
      type: "code.patch",
      title: `Artifact ${suffix}`,
      content: {
        uri: `aop://${orgId}/artifacts/${artifact}/versions/${version}`,
        mimeType: "text/plain",
        checksum: checksum(String((suffix % 9) + 1)),
        sizeBytes: 128 + suffix,
      },
      producedByTaskId: taskId,
      deliverableType: "code.patch",
      derivedFromVersionIds,
    },
    issuedAt: now,
  });
}

function reviseCommand(
  version: string,
  suffix: number,
  expectedRevision: number,
  derivedFromVersionIds: readonly string[] = [],
): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(900 + suffix)}`,
    type: "artifact.revise",
    organizationId: orgId,
    actor: { type: "agent", id: agentId },
    target: { type: "artifact", id: artifactId },
    expectedRevision,
    idempotencyKey: `artifact.revise.test.${suffix}`,
    payload: {
      versionId: version,
      content: {
        uri: `aop://${orgId}/artifacts/${artifactId}/versions/${version}`,
        mimeType: "text/plain",
        checksum: checksum(String(((suffix + 3) % 9) + 1)),
        sizeBytes: 256 + suffix,
      },
      producedByTaskId: taskId,
      deliverableType: "code.patch",
      derivedFromVersionIds,
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
     ) VALUES ($1,'Artifact Integration','company','active','Test Artifact truth','human',$2,'human_managed',0,$3,$3)`,
    [orgId, userId, now],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES ($1,'Artifact Worker','0.1.0','Publishes durable outputs','["backend"]','{"adapter":"runtime.test"}',0,$2,$2)`,
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
     ) VALUES ($1,$2,'Produce truth','Publish durable Artifact','human',$3,'["artifact exists"]','high','active',0,$4,$4)`,
    [goalId, orgId, userId, now],
  );
  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       owner_agent_id, priority, state, scope, deliverables, acceptance_criteria,
       required_capabilities, constraints, budget, revision, created_at, updated_at
     ) VALUES ($1,$2,$3,'Publish output','Create Artifact','human',$4,$5,'high','running',
       '{"includes":["artifact"],"excludes":[]}',
       '[{"type":"code.patch","description":"patch","required":true}]',
       '["artifact recorded"]','["backend"]','{}','{}',0,$6,$6)`,
    [taskId, orgId, goalId, userId, agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES
       ($1,$3,'agent',$4,'artifact.create','allow','{}','human',$5,0,$6),
       ($2,$3,'agent',$4,'artifact.revise','allow','{}','human',$5,0,$6)`,
    [`per_${ulid(31)}`, `per_${ulid(32)}`, orgId, agentId, userId, now],
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

describeDb("PostgreSQL Artifact write path", () => {
  it("creates version 1, Task output, Events and Outbox atomically and replays idempotently", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    const command = createCommand(artifactId, versionOneId, 1);
    const first = await bus.execute(command);
    expect(first.ok).toBe(true);

    expect((await pool.query("SELECT revision FROM aop.artifacts WHERE id = $1", [artifactId])).rows[0]).toMatchObject({
      revision: "0",
    });
    expect((await pool.query("SELECT version, status, checksum FROM aop.artifact_versions WHERE id = $1", [versionOneId])).rows[0]).toMatchObject({
      version: 1,
      status: "draft",
      checksum: checksum("2"),
    });
    expect(Number((await pool.query("SELECT count(*) FROM aop.task_artifact_outputs WHERE artifact_version_id = $1", [versionOneId])).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(2);
    expect(Number((await pool.query("SELECT count(*) FROM aop.outbox_events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(2);

    const replay = await bus.execute(command);
    expect(replay).toEqual(first);
    expect(Number((await pool.query("SELECT count(*) FROM aop.artifact_versions WHERE artifact_id = $1", [artifactId])).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(2);
  });

  it("creates a contiguous immutable revision with supersession and lineage", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    expect((await bus.execute(createCommand(artifactId, versionOneId, 2))).ok).toBe(true);
    const revised = await bus.execute(reviseCommand(versionTwoId, 2, 0, [versionOneId]));
    expect(revised.ok).toBe(true);

    expect((await pool.query("SELECT revision FROM aop.artifacts WHERE id = $1", [artifactId])).rows[0]).toMatchObject({
      revision: "1",
    });
    const versions = await pool.query(
      "SELECT id, version, supersedes_version_id FROM aop.artifact_versions WHERE artifact_id = $1 ORDER BY version",
      [artifactId],
    );
    expect(versions.rows).toEqual([
      { id: versionOneId, version: 1, supersedes_version_id: null },
      { id: versionTwoId, version: 2, supersedes_version_id: versionOneId },
    ]);
    expect((await pool.query("SELECT parent_version_id, relationship FROM aop.artifact_lineage WHERE child_version_id = $1", [versionTwoId])).rows).toEqual([
      { parent_version_id: versionOneId, relationship: "derived_from" },
    ]);

    const original = await pool.query("SELECT checksum FROM aop.artifact_versions WHERE id = $1", [versionOneId]);
    expect(original.rows[0]?.checksum).toBe(checksum("3"));
  });

  it("allows only one concurrent revise from the same expected Artifact revision", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    expect((await bus.execute(createCommand(artifactId, versionOneId, 3))).ok).toBe(true);

    const results = await Promise.all([
      bus.execute(reviseCommand(versionTwoId, 31, 0, [versionOneId])),
      bus.execute(reviseCommand(versionThreeId, 32, 0, [versionOneId])),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const rejected = results.find((result) => !result.ok);
    expect(rejected && !rejected.ok ? rejected.error.code : undefined).toBe("revision_conflict");
    expect(Number((await pool.query("SELECT count(*) FROM aop.artifact_versions WHERE artifact_id = $1", [artifactId])).rows[0].count)).toBe(2);
    expect((await pool.query("SELECT revision FROM aop.artifacts WHERE id = $1", [artifactId])).rows[0]?.revision).toBe("1");
  });

  it("serializes concurrent create attempts for the same Artifact identity", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    const results = await Promise.all([
      bus.execute(createCommand(artifactIdTwo, versionThreeId, 41)),
      bus.execute(createCommand(artifactIdTwo, versionFourId, 42)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const rejected = results.find((result) => !result.ok);
    expect(rejected && !rejected.ok ? rejected.error.code : undefined).toBe("invariant_violation");
    expect(Number((await pool.query("SELECT count(*) FROM aop.artifacts WHERE id = $1", [artifactIdTwo])).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.artifact_versions WHERE artifact_id = $1", [artifactIdTwo])).rows[0].count)).toBe(1);
  });

  it("rejects missing lineage references without partial Artifact/Event/Outbox state", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    const result = await bus.execute(createCommand(artifactId, versionOneId, 5, [missingVersionId]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("scope_mismatch");
    expect(Number((await pool.query("SELECT count(*) FROM aop.artifacts WHERE id = $1", [artifactId])).rows[0].count)).toBe(0);
    expect(Number((await pool.query("SELECT count(*) FROM aop.artifact_versions WHERE artifact_id = $1", [artifactId])).rows[0].count)).toBe(0);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(0);
    expect(Number((await pool.query("SELECT count(*) FROM aop.outbox_events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(0);
  });
});

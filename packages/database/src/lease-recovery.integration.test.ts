import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  CommandGateway,
  LeaseExpireHandler,
  LeaseHeartbeatHandler,
  TaskClaimHandler,
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
import {
  DeterministicLeaseReaper,
  DeterministicScheduler,
  PostgresExpiredLeaseStore,
  PostgresSchedulerCandidateStore,
} from "@aop/scheduler";

import { PostgresAuthorizationResolver, PostgresCommandStore } from "./postgres-command-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(41)}`;
const userId = `usr_${ulid(41)}`;
const agentAId = `agt_${ulid(42)}`;
const agentBId = `agt_${ulid(41)}`;
const membershipAId = `mem_${ulid(42)}`;
const membershipBId = `mem_${ulid(41)}`;
const roleId = `rol_${ulid(41)}`;
const goalId = `gol_${ulid(41)}`;
const taskId = `tsk_${ulid(41)}`;
const runOneId = `run_${ulid(41)}`;
const leaseOneId = `lea_${ulid(41)}`;
const initialTime = "2026-08-25T10:00:00.000Z";

let currentTime = initialTime;
const clock = () => currentTime;

function ids(): GatewayIds {
  let event = 500;
  let approval = 500;
  return {
    nextEventId: () => `evt_${ulid(++event)}` as EventId,
    nextApprovalRequestId: () => `apr_${ulid(++approval)}` as ApprovalRequestId,
  };
}

function gateway(): CommandGateway {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  return new CommandGateway({
    store: new PostgresCommandStore(pool),
    authorization: new PostgresAuthorizationResolver(clock),
    handlers: [new TaskClaimHandler(clock), new LeaseHeartbeatHandler(clock), new LeaseExpireHandler(clock)],
    ids: ids(),
    digest: semanticCommandDigest,
    now: clock,
  });
}

function claimAttemptOne(): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(401)}` as CommandId,
    type: "task.claim",
    organizationId: orgId,
    actor: { type: "system", id: "scheduler" },
    target: { type: "task", id: taskId },
    expectedRevision: 0,
    idempotencyKey: "recovery.initial.claim",
    payload: {
      agentId: agentAId,
      runId: runOneId,
      leaseId: leaseOneId,
      attempt: 1,
      runtimeType: "runtime.test",
      workspaceId: "recovery-attempt-1",
      leaseSeconds: 60,
      heartbeatIntervalSeconds: 10,
    },
    issuedAt: currentTime,
  });
}

function heartbeat(expectedRevision = 0): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(402)}` as CommandId,
    type: "lease.heartbeat",
    organizationId: orgId,
    actor: { type: "system", id: "runtime-manager" },
    target: { type: "lease", id: leaseOneId },
    expectedRevision,
    idempotencyKey: `recovery.heartbeat.${expectedRevision}`,
    payload: { extendSeconds: 120 },
    issuedAt: currentTime,
  });
}

function staleExpiry(): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(403)}` as CommandId,
    type: "lease.expire",
    organizationId: orgId,
    actor: { type: "system", id: "runtime-manager" },
    target: { type: "lease", id: leaseOneId },
    expectedRevision: 0,
    idempotencyKey: "recovery.stale.expiry",
    payload: {},
    issuedAt: currentTime,
  });
}

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.leases WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM aop.task_runs WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [orgId]);
  await pool.query("DELETE FROM aop.agents WHERE id = ANY($1::text[])", [[agentAId, agentBId]]);
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES ($1,'Lease Recovery','company','active','Recover lost work','human',$2,'human_managed',0,$3,$3)`,
    [orgId, userId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES
       ($1,'Worker A','0.1.0','Initial runtime worker','["backend"]','{"adapter":"runtime.test"}',0,$3,$3),
       ($2,'Worker B','0.1.0','Failover runtime worker','["backend"]','{"adapter":"runtime.test"}',0,$3,$3)`,
    [agentAId, agentBId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision)
     VALUES ($1,$3,$4,'active',$5,0), ($2,$3,$6,'active',$5,0)`,
    [membershipAId, membershipBId, orgId, agentAId, initialTime, agentBId],
  );
  await pool.query(
    `INSERT INTO aop.roles (
       id, organization_id, name, purpose, responsibilities, authority, revision, created_at, updated_at
     ) VALUES ($1,$2,'Backend Developer','Execute backend work','["implement"]',
       '{"allowedCapabilities":[],"approvalRequiredCapabilities":[],"deniedCapabilities":[]}',0,$3,$3)`,
    [roleId, orgId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.role_assignments (organization_id, agent_id, role_id, active_from)
     VALUES ($1,$2,$4,$5), ($1,$3,$4,$5)`,
    [orgId, agentAId, agentBId, roleId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Recover Work','Complete work despite runtime loss','human',$3,'["task recovers"]','high','active',0,$4,$4)`,
    [goalId, orgId, userId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       priority, state, scope, deliverables, acceptance_criteria, required_capabilities,
       constraints, budget, revision, created_at, updated_at
     ) VALUES ($1,$2,$3,'Recoverable task','Survive runtime loss','human',$4,'high','ready',
       '{"includes":["api"],"excludes":[]}',
       '[{"type":"code","description":"implementation","required":true}]',
       '["work can be retried"]','["backend"]','{}','{}',0,$5,$5)`,
    [taskId, orgId, goalId, userId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES
       ($1,$4,'system','scheduler','task.claim','allow','{}','human',$5,0,$6),
       ($2,$4,'system','runtime-manager','lease.heartbeat','allow','{}','human',$5,0,$6),
       ($3,$4,'system','runtime-manager','lease.expire','allow','{}','human',$5,0,$6)`,
    [`per_${ulid(411)}`, `per_${ulid(412)}`, `per_${ulid(413)}`, orgId, userId, initialTime],
  );
}

beforeEach(async () => {
  currentTime = initialTime;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool?.end();
});

describeDb("PostgreSQL lease recovery", () => {
  it("heartbeats a live lease and fences a stale expiry by revision", async () => {
    if (pool === undefined) return;
    await seed();
    const commandGateway = gateway();

    expect((await commandGateway.execute(claimAttemptOne())).ok).toBe(true);

    currentTime = "2026-08-25T10:00:30.000Z";
    const heartbeatResult = await commandGateway.execute(heartbeat());
    expect(heartbeatResult.ok).toBe(true);

    const renewed = await pool.query(
      "SELECT status, revision, expires_at FROM aop.leases WHERE organization_id = $1 AND id = $2",
      [orgId, leaseOneId],
    );
    expect(renewed.rows[0]?.status).toBe("active");
    expect(Number(renewed.rows[0]?.revision)).toBe(1);
    expect(new Date(renewed.rows[0]?.expires_at).toISOString()).toBe("2026-08-25T10:02:30.000Z");

    const run = await pool.query("SELECT status, revision, heartbeat_at FROM aop.task_runs WHERE id = $1", [runOneId]);
    expect(run.rows[0]?.status).toBe("created");
    expect(Number(run.rows[0]?.revision)).toBe(1);
    expect(new Date(run.rows[0]?.heartbeat_at).toISOString()).toBe(currentTime);

    currentTime = "2026-08-25T10:01:01.000Z";
    const staleResult = await commandGateway.execute(staleExpiry());
    expect(staleResult.ok).toBe(false);
    if (!staleResult.ok) expect(staleResult.error.code).toBe("revision_conflict");

    const stillActive = await pool.query("SELECT status, revision FROM aop.leases WHERE id = $1", [leaseOneId]);
    expect(stillActive.rows[0]).toMatchObject({ status: "active", revision: "1" });
    expect((await pool.query("SELECT state, owner_agent_id FROM aop.tasks WHERE id = $1", [taskId])).rows[0]).toMatchObject({
      state: "leased",
      owner_agent_id: agentAId,
    });
  });

  it("reaps an expired lease atomically and lets Scheduler claim attempt 2 on another agent", async () => {
    if (pool === undefined) return;
    await seed();
    const commandGateway = gateway();

    expect((await commandGateway.execute(claimAttemptOne())).ok).toBe(true);

    currentTime = "2026-08-25T10:01:01.000Z";
    const reaper = new DeterministicLeaseReaper({
      store: new PostgresExpiredLeaseStore(pool),
      executor: commandGateway,
      now: clock,
    });
    const recovery = await reaper.runOnce();
    expect(recovery.recovered?.leaseId).toBe(leaseOneId);
    expect(recovery.commandResult?.ok).toBe(true);

    const lease = await pool.query("SELECT status, revision FROM aop.leases WHERE id = $1", [leaseOneId]);
    expect(lease.rows[0]).toMatchObject({ status: "expired", revision: "1" });

    const lostRun = await pool.query(
      "SELECT status, revision, failure_reason, finished_at FROM aop.task_runs WHERE id = $1",
      [runOneId],
    );
    expect(lostRun.rows[0]?.status).toBe("lost");
    expect(Number(lostRun.rows[0]?.revision)).toBe(1);
    expect(lostRun.rows[0]?.failure_reason).toBe("lease_expired");
    expect(new Date(lostRun.rows[0]?.finished_at).toISOString()).toBe(currentTime);

    const requeued = await pool.query("SELECT state, owner_agent_id, revision FROM aop.tasks WHERE id = $1", [taskId]);
    expect(requeued.rows[0]).toMatchObject({ state: "ready", owner_agent_id: null, revision: "2" });

    const scheduler = new DeterministicScheduler({
      store: new PostgresSchedulerCandidateStore(pool),
      executor: commandGateway,
      now: clock,
      leaseSeconds: 60,
      heartbeatIntervalSeconds: 10,
    });
    const retry = await scheduler.runOnce();
    expect(retry.claimed?.taskId).toBe(taskId);
    expect(retry.claimed?.agentId).toBe(agentBId);
    expect(retry.claimed?.attempt).toBe(2);
    expect(retry.commandResult?.ok).toBe(true);

    const taskAfterRetry = await pool.query("SELECT state, owner_agent_id, revision FROM aop.tasks WHERE id = $1", [taskId]);
    expect(taskAfterRetry.rows[0]).toMatchObject({ state: "leased", owner_agent_id: agentBId, revision: "3" });

    const attempts = await pool.query(
      "SELECT attempt, agent_id, status FROM aop.task_runs WHERE organization_id = $1 AND task_id = $2 ORDER BY attempt",
      [orgId, taskId],
    );
    expect(attempts.rows).toEqual([
      expect.objectContaining({ attempt: 1, agent_id: agentAId, status: "lost" }),
      expect.objectContaining({ attempt: 2, agent_id: agentBId, status: "created" }),
    ]);

    expect(Number((await pool.query("SELECT count(*) FROM aop.leases WHERE task_id = $1 AND status = 'active'", [taskId])).rows[0]?.count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id = $1", [orgId])).rows[0]?.count)).toBe(9);
    expect(Number((await pool.query("SELECT count(*) FROM aop.outbox_events WHERE organization_id = $1", [orgId])).rows[0]?.count)).toBe(9);
  });
});

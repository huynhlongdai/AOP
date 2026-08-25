import { createHash } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { CommandGateway, TaskClaimHandler, type GatewayIds } from "@aop/command-bus";
import {
  AOP_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  type CommandEnvelope,
  type CommandId,
  type EventId,
  type ApprovalRequestId,
} from "@aop/protocol";

import { PostgresAuthorizationResolver, PostgresCommandStore } from "./postgres-command-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(21)}`;
const userId = `usr_${ulid(21)}`;
const agentId = `agt_${ulid(21)}`;
const membershipId = `mem_${ulid(21)}`;
const roleId = `rol_${ulid(21)}`;
const goalId = `gol_${ulid(21)}`;
const taskOneId = `tsk_${ulid(21)}`;
const taskTwoId = `tsk_${ulid(22)}`;
const now = "2026-08-25T08:00:00.000Z";

function digest(command: CommandEnvelope): string {
  const content = JSON.stringify({
    type: command.type,
    target: command.target,
    expectedRevision: command.expectedRevision,
    payload: command.payload,
  });
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function ids(): GatewayIds {
  let event = 100;
  let approval = 100;
  return {
    nextEventId: () => `evt_${ulid(++event)}` as EventId,
    nextApprovalRequestId: () => `apr_${ulid(++approval)}` as ApprovalRequestId,
  };
}

function command(taskId: string, suffix: number): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(200 + suffix)}` as CommandId,
    type: "task.claim",
    organizationId: orgId,
    actor: { type: "system", id: "scheduler" },
    target: { type: "task", id: taskId },
    expectedRevision: 0,
    idempotencyKey: `scheduler.claim.test.${suffix}`,
    payload: {
      agentId,
      runId: `run_${ulid(200 + suffix)}`,
      leaseId: `lea_${ulid(200 + suffix)}`,
      attempt: 1,
      runtimeType: "runtime.test",
      workspaceId: `workspace-${suffix}`,
      leaseSeconds: 300,
      heartbeatIntervalSeconds: 60,
    },
    issuedAt: now,
  });
}

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [orgId]);
  await pool.query("DELETE FROM aop.agents WHERE id = $1", [agentId]);
}

async function seed(twoTasks = false): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES ($1,'Scheduler Integration','company','active','Test scheduler','human',$2,'human_managed',0,$3,$3)`,
    [orgId, userId, now],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES ($1,'Backend Worker','0.1.0','Scheduler worker','["backend"]','{"adapter":"runtime.test"}',0,$2,$2)`,
    [agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision)
     VALUES ($1,$2,$3,'active',$4,0)`,
    [membershipId, orgId, agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.roles (
       id, organization_id, name, purpose, responsibilities, authority, revision, created_at, updated_at
     ) VALUES ($1,$2,'Backend Developer','Implement backend work','["implement"]',
       '{"allowedCapabilities":[],"approvalRequiredCapabilities":[],"deniedCapabilities":[]}',0,$3,$3)`,
    [roleId, orgId, now],
  );
  await pool.query(
    `INSERT INTO aop.role_assignments (organization_id, agent_id, role_id, active_from)
     VALUES ($1,$2,$3,$4)`,
    [orgId, agentId, roleId, now],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Build API','Ship verified API','human',$3,'["works"]','high','active',0,$4,$4)`,
    [goalId, orgId, userId, now],
  );
  const insertTask = async (taskId: string, title: string) =>
    pool.query(
      `INSERT INTO aop.tasks (
         id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
         priority, state, scope, deliverables, acceptance_criteria, required_capabilities,
         constraints, budget, revision, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,'Implement task','human',$5,'high','ready',
         '{"includes":["api"],"excludes":[]}',
         '[{"type":"code","description":"implementation","required":true}]',
         '["tests pass"]','["backend"]','{}','{}',0,$6,$6)`,
      [taskId, orgId, goalId, title, userId, now],
    );
  await insertTask(taskOneId, "Task one");
  if (twoTasks) await insertTask(taskTwoId, "Task two");
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES ($1,$2,'system','scheduler','task.claim','allow','{}','human',$3,0,$4)`,
    [`per_${ulid(21)}`, orgId, userId, now],
  );
}

function gateway(): CommandGateway {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  return new CommandGateway({
    store: new PostgresCommandStore(pool),
    authorization: new PostgresAuthorizationResolver(() => now),
    handlers: [new TaskClaimHandler(() => now)],
    ids: ids(),
    digest,
    now: () => now,
  });
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool?.end();
});

describeDb("PostgreSQL task.claim", () => {
  it("atomically leases a task, creates run/lease, events/outbox, and replays idempotently", async () => {
    if (pool === undefined) return;
    await seed();
    const input = command(taskOneId, 1);
    const first = await gateway().execute(input);
    expect(first.ok).toBe(true);

    const task = await pool.query("SELECT state, owner_agent_id, revision FROM aop.tasks WHERE id = $1", [taskOneId]);
    expect(task.rows[0]).toMatchObject({ state: "leased", owner_agent_id: agentId, revision: "1" });
    expect(Number((await pool.query("SELECT count(*) FROM aop.task_runs WHERE task_id = $1", [taskOneId])).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.leases WHERE task_id = $1 AND status = 'active'", [taskOneId])).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(3);
    expect(Number((await pool.query("SELECT count(*) FROM aop.outbox_events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(3);

    const second = await gateway().execute(input);
    expect(second).toEqual(first);
    expect(Number((await pool.query("SELECT count(*) FROM aop.task_runs WHERE task_id = $1", [taskOneId])).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(3);
  });

  it("allows only one of two concurrent task claims to consume the same v0 agent capacity", async () => {
    if (pool === undefined) return;
    await seed(true);
    const [left, right] = await Promise.all([
      gateway().execute(command(taskOneId, 1)),
      gateway().execute(command(taskTwoId, 2)),
    ]);
    expect([left.ok, right.ok].filter(Boolean)).toHaveLength(1);

    const states = await pool.query(
      "SELECT state FROM aop.tasks WHERE organization_id = $1 ORDER BY id",
      [orgId],
    );
    expect(states.rows.map((row) => row.state).sort()).toEqual(["leased", "ready"]);
    expect(Number((await pool.query("SELECT count(*) FROM aop.task_runs WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.leases WHERE organization_id = $1 AND status = 'active'", [orgId])).rows[0].count)).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(3);
  });

  it("rejects a task while a hard prerequisite is incomplete without partial mutation", async () => {
    if (pool === undefined) return;
    await seed(true);
    await pool.query(
      `INSERT INTO aop.task_dependencies (organization_id, task_id, depends_on_task_id, dependency_type)
       VALUES ($1,$2,$3,'hard')`,
      [orgId, taskTwoId, taskOneId],
    );
    const result = await gateway().execute(command(taskTwoId, 2));
    expect(result).toMatchObject({ ok: false, error: { code: "invariant_violation" } });
    expect((await pool.query("SELECT state FROM aop.tasks WHERE id = $1", [taskTwoId])).rows[0].state).toBe("ready");
    expect(Number((await pool.query("SELECT count(*) FROM aop.task_runs WHERE task_id = $1", [taskTwoId])).rows[0].count)).toBe(0);
    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id = $1", [orgId])).rows[0].count)).toBe(0);
  });
});

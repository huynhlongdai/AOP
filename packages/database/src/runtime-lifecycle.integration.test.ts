import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  CommandGateway,
  TaskClaimHandler,
  TaskRunFinishHandler,
  TaskRunPrepareHandler,
  TaskRunStartHandler,
  semanticCommandDigest,
  type GatewayIds,
} from "@aop/command-bus";
import {
  AOP_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  RuntimeRunReportSchema,
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

const orgId = `org_${ulid(91)}`;
const userId = `usr_${ulid(91)}`;
const agentId = `agt_${ulid(91)}`;
const membershipId = `mem_${ulid(91)}`;
const goalId = `gol_${ulid(91)}`;
const taskId = `tsk_${ulid(91)}`;
const runId = `run_${ulid(91)}`;
const leaseId = `lea_${ulid(91)}`;
const manifestId = `ctx_${ulid(91)}`;
const missingManifestId = `ctx_${ulid(92)}`;
const initialTime = "2026-08-25T17:30:00.000Z";

let currentTime = initialTime;
const clock = () => currentTime;

function ids(): GatewayIds {
  let event = 900;
  let approval = 900;
  return {
    nextEventId: () => `evt_${ulid(++event)}` as EventId,
    nextApprovalRequestId: () => `apr_${ulid(++approval)}` as ApprovalRequestId,
  };
}

function gateway(): CommandGateway {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  return new CommandGateway({
    store: new PostgresRuntimeCommandStore(pool),
    authorization: new PostgresAuthorizationResolver(clock),
    handlers: [
      new TaskClaimHandler(clock),
      new TaskRunPrepareHandler(),
      new TaskRunStartHandler(clock),
      new TaskRunFinishHandler(clock),
    ],
    ids: ids(),
    digest: semanticCommandDigest,
    now: clock,
  });
}

function command(
  value: number,
  type: string,
  target: CommandEnvelope["target"],
  expectedRevision: number,
  payload: Readonly<Record<string, unknown>>,
): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(value)}` as CommandId,
    type,
    organizationId: orgId,
    actor: type === "task.claim" ? { type: "system", id: "scheduler" } : { type: "system", id: "runtime-manager" },
    target,
    expectedRevision,
    idempotencyKey: `runtime-lifecycle.${value}.${type}`,
    payload,
    issuedAt: currentTime,
  });
}

function claim(): CommandEnvelope {
  return command(910, "task.claim", { type: "task", id: taskId }, 0, {
    agentId,
    runId,
    leaseId,
    attempt: 1,
    runtimeType: "runtime.test",
    workspaceId: "runtime-lifecycle-workspace",
    leaseSeconds: 600,
    heartbeatIntervalSeconds: 30,
  });
}

function prepare(contextManifestId = manifestId, value = 911): CommandEnvelope {
  return command(value, "task_run.prepare", { type: "task_run", id: runId }, 0, {
    runtimeId: "provider-runtime-91",
    contextManifestId,
    adapter: "runtime.test",
    provider: "test-provider",
    model: "test-model",
    traceRefs: [{ provider: "test-provider", traceId: "prepare-91" }],
  });
}

function start(value = 912): CommandEnvelope {
  return command(value, "task_run.start", { type: "task_run", id: runId }, 1, { taskExpectedRevision: 1 });
}

function finish(
  value: number,
  status: "succeeded" | "failed" | "cancelled",
  taskExpectedRevision = 2,
): CommandEnvelope {
  return command(value, "task_run.finish", { type: "task_run", id: runId }, 2, {
    taskExpectedRevision,
    contextManifestId: manifestId,
    runtimeId: "provider-runtime-91",
    adapter: "runtime.test",
    provider: "test-provider",
    model: "test-model",
    status,
    usage: { inputTokens: 100, outputTokens: 20, toolCalls: 1, costCredits: 0.25 },
    traceRefs: [{ provider: "test-provider", traceId: "run-91" }],
    commandOutcomes: [
      {
        proposalIndex: 0,
        commandType: "task.create",
        status: "not_forwarded",
        reason: "command_not_allowed_by_execution_policy",
      },
    ],
    ...(status === "failed" ? { failureReason: "provider_timeout" } : {}),
  });
}

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.leases WHERE organization_id = $1", [orgId]);
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
     ) VALUES ($1,'Runtime Lifecycle','company','active','Verify Runtime lifecycle','human',$2,'human_managed',0,$3,$3)`,
    [orgId, userId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES ($1,'Runtime Worker','0.1.0','Runtime lifecycle worker','["backend"]','{"adapter":"runtime.test"}',0,$2,$2)`,
    [agentId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision)
     VALUES ($1,$2,$3,'active',$4,0)`,
    [membershipId, orgId, agentId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Runtime Goal','Execute bounded runtime lifecycle','human',$3,'["lifecycle verified"]','high','active',0,$4,$4)`,
    [goalId, orgId, userId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       priority, state, scope, deliverables, acceptance_criteria, required_capabilities,
       constraints, budget, revision, created_at, updated_at
     ) VALUES ($1,$2,$3,'Runtime Task','Verify lifecycle','human',$4,'high','ready',
       '{"includes":["runtime"],"excludes":[]}',
       '[{"type":"code","description":"implementation","required":true}]',
       '["lifecycle verified"]','["backend"]','{}','{}',0,$5,$5)`,
    [taskId, orgId, goalId, userId, initialTime],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES
       ($1,$5,'system','scheduler','task.claim','allow','{}','human',$6,0,$7),
       ($2,$5,'system','runtime-manager','task_run.prepare','allow','{}','human',$6,0,$7),
       ($3,$5,'system','runtime-manager','task_run.start','allow','{}','human',$6,0,$7),
       ($4,$5,'system','runtime-manager','task_run.finish','allow','{}','human',$6,0,$7)`,
    [`per_${ulid(911)}`, `per_${ulid(912)}`, `per_${ulid(913)}`, `per_${ulid(914)}`, orgId, userId, initialTime],
  );
}

async function seedManifest(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  const requiredKinds = ["policy", "identity", "role", "authority", "goal", "task", "output_contract"];
  const fragments = requiredKinds.map((kind, index) => ({
    key: `${kind}:${index}`,
    kind,
    trust: "authoritative",
    mandatory: true,
    authorityWeight: 1,
    relevanceWeight: 1,
    tokenEstimate: 1,
    content: JSON.stringify({ kind }),
    digest: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
  }));
  await pool.query(
    `INSERT INTO aop.context_manifests (
       id, organization_id, task_id, run_id, agent_id, task_revision,
       schema_version, protocol_version, fragments, total_token_estimate, compiled_at
     ) VALUES ($1,$2,$3,$4,$5,1,1,'0.1.0',$6::jsonb,$7,$8)`,
    [manifestId, orgId, taskId, runId, agentId, JSON.stringify(fragments), fragments.length, initialTime],
  );
}

beforeEach(async () => {
  currentTime = initialTime;
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await pool?.end();
});

describeDb("PostgreSQL authoritative Runtime lifecycle", () => {
  it("rejects Runtime preparation when Context Manifest is not bound to the Run", async () => {
    if (pool === undefined) return;
    const commandGateway = gateway();
    expect((await commandGateway.execute(claim())).ok).toBe(true);
    await seedManifest();

    const result = await commandGateway.execute(prepare(missingManifestId));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invariant_violation");

    const run = await pool.query("SELECT status, runtime_id, revision FROM aop.task_runs WHERE id = $1", [runId]);
    expect(run.rows[0]).toMatchObject({ status: "created", runtime_id: null, revision: "0" });
  });

  it("prepares and starts atomically through Runtime Manager authority", async () => {
    if (pool === undefined) return;
    const commandGateway = gateway();
    expect((await commandGateway.execute(claim())).ok).toBe(true);
    await seedManifest();

    expect((await commandGateway.execute(prepare())).ok).toBe(true);
    currentTime = "2026-08-25T17:31:00.000Z";
    expect((await commandGateway.execute(start())).ok).toBe(true);

    const run = await pool.query(
      "SELECT status, runtime_id, revision, started_at, heartbeat_at FROM aop.task_runs WHERE id = $1",
      [runId],
    );
    expect(run.rows[0]).toMatchObject({ status: "running", runtime_id: "provider-runtime-91", revision: "2" });
    expect(new Date(run.rows[0]?.started_at).toISOString()).toBe(currentTime);
    expect(new Date(run.rows[0]?.heartbeat_at).toISOString()).toBe(currentTime);

    const task = await pool.query("SELECT state, revision, owner_agent_id FROM aop.tasks WHERE id = $1", [taskId]);
    expect(task.rows[0]).toMatchObject({ state: "running", revision: "2", owner_agent_id: agentId });
  });

  it("denies succeeded Run while Task is still running and preserves active execution state", async () => {
    if (pool === undefined) return;
    const commandGateway = gateway();
    expect((await commandGateway.execute(claim())).ok).toBe(true);
    await seedManifest();
    expect((await commandGateway.execute(prepare())).ok).toBe(true);
    expect((await commandGateway.execute(start())).ok).toBe(true);

    currentTime = "2026-08-25T17:32:00.000Z";
    const result = await commandGateway.execute(finish(913, "succeeded"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invariant_violation");

    expect((await pool.query("SELECT status, revision FROM aop.task_runs WHERE id = $1", [runId])).rows[0]).toMatchObject({
      status: "running",
      revision: "2",
    });
    expect((await pool.query("SELECT status, revision FROM aop.leases WHERE id = $1", [leaseId])).rows[0]).toMatchObject({
      status: "active",
      revision: "0",
    });
    expect((await pool.query("SELECT state, revision FROM aop.tasks WHERE id = $1", [taskId])).rows[0]).toMatchObject({
      state: "running",
      revision: "2",
    });
    expect(Number((await pool.query("SELECT count(*) FROM aop.runtime_run_reports WHERE run_id = $1", [runId])).rows[0]?.count)).toBe(0);
  });

  it("atomically fails the Run, releases Lease, requeues Task and persists immutable report", async () => {
    if (pool === undefined) return;
    const commandGateway = gateway();
    expect((await commandGateway.execute(claim())).ok).toBe(true);
    await seedManifest();
    expect((await commandGateway.execute(prepare())).ok).toBe(true);
    currentTime = "2026-08-25T17:31:00.000Z";
    expect((await commandGateway.execute(start())).ok).toBe(true);

    currentTime = "2026-08-25T17:33:00.000Z";
    const result = await commandGateway.execute(finish(914, "failed"));
    expect(result.ok).toBe(true);

    const run = await pool.query("SELECT status, revision, failure_reason, finished_at FROM aop.task_runs WHERE id = $1", [runId]);
    expect(run.rows[0]).toMatchObject({ status: "failed", revision: "3", failure_reason: "provider_timeout" });
    expect(new Date(run.rows[0]?.finished_at).toISOString()).toBe(currentTime);

    expect((await pool.query("SELECT status, revision FROM aop.leases WHERE id = $1", [leaseId])).rows[0]).toMatchObject({
      status: "released",
      revision: "1",
    });
    expect((await pool.query("SELECT state, owner_agent_id, revision FROM aop.tasks WHERE id = $1", [taskId])).rows[0]).toMatchObject({
      state: "ready",
      owner_agent_id: null,
      revision: "3",
    });

    const reportRow = (
      await pool.query(
        `SELECT organization_id, run_id, task_id, agent_id, attempt, context_manifest_id,
                runtime_id, adapter, provider, model, status, usage, trace_refs, command_outcomes,
                failure_reason, started_at, finished_at, created_at, schema_version, protocol_version
           FROM aop.runtime_run_reports
          WHERE organization_id = $1 AND run_id = $2`,
        [orgId, runId],
      )
    ).rows[0];
    const report = RuntimeRunReportSchema.parse({
      schemaVersion: Number(reportRow?.schema_version),
      protocolVersion: reportRow?.protocol_version,
      organizationId: reportRow?.organization_id,
      taskId: reportRow?.task_id,
      runId: reportRow?.run_id,
      agentId: reportRow?.agent_id,
      attempt: Number(reportRow?.attempt),
      contextManifestId: reportRow?.context_manifest_id,
      runtimeId: reportRow?.runtime_id,
      adapter: reportRow?.adapter,
      provider: reportRow?.provider,
      model: reportRow?.model,
      status: reportRow?.status,
      usage: reportRow?.usage,
      traceRefs: reportRow?.trace_refs,
      commandOutcomes: reportRow?.command_outcomes,
      failureReason: reportRow?.failure_reason,
      startedAt: new Date(reportRow?.started_at).toISOString(),
      finishedAt: new Date(reportRow?.finished_at).toISOString(),
      createdAt: new Date(reportRow?.created_at).toISOString(),
    });
    expect(report).toMatchObject({
      runId,
      taskId,
      agentId,
      contextManifestId: manifestId,
      runtimeId: "provider-runtime-91",
      adapter: "runtime.test",
      provider: "test-provider",
      model: "test-model",
      status: "failed",
      failureReason: "provider_timeout",
      usage: { inputTokens: 100, outputTokens: 20, toolCalls: 1, costCredits: 0.25 },
    });
    expect(report.commandOutcomes).toEqual([
      expect.objectContaining({
        proposalIndex: 0,
        commandType: "task.create",
        status: "not_forwarded",
        reason: "command_not_allowed_by_execution_policy",
      }),
    ]);

    await expect(
      pool.query(
        "UPDATE aop.runtime_run_reports SET status = 'cancelled' WHERE organization_id = $1 AND run_id = $2",
        [orgId, runId],
      ),
    ).rejects.toThrow(/immutable/);

    expect(Number((await pool.query("SELECT count(*) FROM aop.events WHERE organization_id = $1", [orgId])).rows[0]?.count)).toBe(9);
    expect(Number((await pool.query("SELECT count(*) FROM aop.outbox_events WHERE organization_id = $1", [orgId])).rows[0]?.count)).toBe(9);
  });
});

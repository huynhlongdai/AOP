import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  CommandGateway,
  TaskClaimHandler,
  TaskRunFinishHandler,
  TaskRunPrepareHandler,
  TaskRunStartHandler,
  TaskSubmitReviewHandler,
  semanticCommandDigest,
  type GatewayIds,
} from "@aop/command-bus";
import {
  PostgresAuthorizationResolver,
  PostgresContextManifestStore,
  PostgresRuntimeCommandStore,
} from "@aop/database";
import {
  AOP_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  RuntimeRunReportSchema,
  type Agent,
  type ApprovalRequestId,
  type CommandId,
  type EventId,
} from "@aop/protocol";
import {
  GatewayKernelRuntimePort,
  RuntimeManager,
  type PreparedRuntime,
  type RuntimeAdapter,
  type RuntimeExecutionResult,
  type RuntimeInspection,
} from "@aop/runtime";

import { PostgresRuntimeContextProvider } from "./runtime-context-provider.js";
import { PostgresRuntimeExecutionStateReader } from "./runtime-control-state.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(121)}` as const;
const ownerId = `usr_${ulid(121)}`;
const workerAgentId = `agt_${ulid(121)}` as const;
const reviewerAgentId = `agt_${ulid(122)}`;
const roleId = `rol_${ulid(121)}`;
const goalId = `gol_${ulid(121)}`;
const taskId = `tsk_${ulid(121)}` as const;
const runId = `run_${ulid(121)}` as const;
const leaseId = `lea_${ulid(121)}`;
const manifestId = `ctx_${ulid(121)}` as const;
const reviewId = `rev_${ulid(121)}` as const;
const now = "2026-08-26T02:30:00.000Z";

const workerAgent: Agent = {
  id: workerAgentId,
  name: "CTO Runtime Worker",
  version: "0.1.0",
  description: "Executes one bounded engineering decomposition task",
  capabilities: ["backend", "task.submit_review"],
  runtime: { adapter: "runtime.test", provider: "test", modelPolicy: "bounded" },
  revision: 0,
  createdAt: now,
  updatedAt: now,
};

function gatewayIds(): GatewayIds {
  let event = 12_100;
  let approval = 12_100;
  return {
    nextEventId: () => `evt_${ulid(++event)}` as EventId,
    nextApprovalRequestId: () => `apr_${ulid(++approval)}` as ApprovalRequestId,
  };
}

function runtimeCommandIds() {
  let command = 12_500;
  return {
    nextCommandId: () => `cmd_${ulid(++command)}` as CommandId,
  };
}

function gateway(): CommandGateway {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  return new CommandGateway({
    store: new PostgresRuntimeCommandStore(pool),
    authorization: new PostgresAuthorizationResolver(() => now),
    handlers: [
      new TaskClaimHandler(() => now),
      new TaskRunPrepareHandler(),
      new TaskRunStartHandler(() => now),
      new TaskSubmitReviewHandler(() => now),
      new TaskRunFinishHandler(() => now),
    ],
    ids: gatewayIds(),
    digest: semanticCommandDigest,
    now: () => now,
  });
}

async function claimTask(commandGateway: CommandGateway): Promise<void> {
  const result = await commandGateway.execute(
    CommandEnvelopeSchema.parse({
      schemaVersion: 1,
      protocolVersion: AOP_PROTOCOL_VERSION,
      commandId: `cmd_${ulid(12_101)}` as CommandId,
      type: "task.claim",
      organizationId: orgId,
      actor: { type: "system", id: "scheduler" },
      target: { type: "task", id: taskId },
      expectedRevision: 0,
      idempotencyKey: `runtime-e2e:${runId}:claim`,
      payload: {
        agentId: workerAgentId,
        runId,
        leaseId,
        attempt: 1,
        runtimeType: "runtime.test",
        workspaceId: "runtime-e2e-workspace",
        leaseSeconds: 600,
        heartbeatIntervalSeconds: 30,
      },
      issuedAt: now,
    }),
  );
  expect(result.ok).toBe(true);
}

class ReviewSubmittingAdapter implements RuntimeAdapter {
  readonly name = "runtime.test";
  prepareInputs: Array<Parameters<RuntimeAdapter["prepare"]>[0]> = [];
  startInputs: Array<Parameters<RuntimeAdapter["start"]>[0]> = [];

  async prepare(input: Parameters<RuntimeAdapter["prepare"]>[0]): Promise<PreparedRuntime> {
    this.prepareInputs.push(input);
    return {
      runtimeId: "provider-runtime-e2e",
      adapter: this.name,
      provider: "test-provider",
      model: "test-model",
      traceRefs: [{ provider: "test-provider", traceId: "prepare-e2e" }],
    };
  }

  async start(input: Parameters<RuntimeAdapter["start"]>[0]): Promise<RuntimeExecutionResult> {
    this.startInputs.push(input);
    if (input.context.taskRevision !== 2) {
      throw new Error(`expected running Task revision 2, got ${input.context.taskRevision}`);
    }
    const taskFragment = input.context.fragments.find((fragment) => fragment.kind === "task");
    if (taskFragment === undefined || !taskFragment.content.includes('"state":"running"')) {
      throw new Error("exact Context does not describe the running Task state");
    }

    return {
      status: "succeeded",
      commandProposals: [
        {
          type: "task.submit_review",
          target: { type: "task", id: taskId },
          expectedRevision: input.context.taskRevision,
          payload: {
            reviewId,
            criteria: [{ key: "runtime.e2e", description: "Control-plane execution completed", required: true }],
          },
        },
      ],
      output: { summary: "submitted bounded work for review" },
      usage: { inputTokens: 220, outputTokens: 40, toolCalls: 0, costCredits: 0.5 },
      traceRefs: [{ provider: "test-provider", traceId: "run-e2e" }],
    };
  }

  async cancel(): Promise<void> {}

  async inspect(): Promise<RuntimeInspection> {
    return { status: "running", traceRefs: [] };
  }
}

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.runtime_run_reports WHERE organization_id=$1", [orgId]);
  await pool.query("DELETE FROM aop.context_manifests WHERE organization_id=$1", [orgId]);
  await pool.query("DELETE FROM aop.leases WHERE organization_id=$1", [orgId]);
  await pool.query("DELETE FROM aop.task_runs WHERE organization_id=$1", [orgId]);
  await pool.query("DELETE FROM aop.organizations WHERE id=$1", [orgId]);
  await pool.query("DELETE FROM aop.agents WHERE id = ANY($1::text[])", [[workerAgentId, reviewerAgentId]]);
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES ($1,'Runtime E2E Org','company','active','Prove the Runtime control plane','human',$2,'assistant_managed',0,$3,$3)`,
    [orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES
       ($1,'CTO Runtime Worker','0.1.0','Executes bounded work','["backend","task.submit_review"]','{"adapter":"runtime.test","provider":"test","modelPolicy":"bounded"}',0,$3,$3),
       ($2,'QA Reviewer','0.1.0','Independent reviewer','["qa"]','{"adapter":"runtime.test"}',0,$3,$3)`,
    [workerAgentId, reviewerAgentId, now],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision) VALUES
       ($1,$3,$4,'active',$5,0),
       ($2,$3,$6,'active',$5,0)`,
    [`mem_${ulid(121)}`, `mem_${ulid(122)}`, orgId, workerAgentId, now, reviewerAgentId],
  );
  await pool.query(
    `INSERT INTO aop.roles (
       id, organization_id, name, purpose, responsibilities, authority, revision, created_at, updated_at
     ) VALUES ($1,$2,'CTO Worker','Deliver one bounded engineering task','["Execute task","Submit for review"]',
       '{"allowedCapabilities":["task.submit_review"],"approvalRequiredCapabilities":[],"deniedCapabilities":["permission.grant"]}',0,$3,$3)`,
    [roleId, orgId, now],
  );
  await pool.query(
    `INSERT INTO aop.role_assignments (organization_id, agent_id, role_id, active_from)
     VALUES ($1,$2,$3,$4)`,
    [orgId, workerAgentId, roleId, "2026-08-26T02:00:00.000Z"],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Runtime Gate','Prove exact-context execution','human',$3,'["Run report persisted","Review created"]','critical','active',0,$4,$4)`,
    [goalId, orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       reviewer_agent_id, priority, state, scope, deliverables, acceptance_criteria,
       required_capabilities, constraints, budget, revision, created_at, updated_at
     ) VALUES ($1,$2,$3,'Runtime control-plane task','Submit bounded output for independent QA','human',$4,$5,'critical','ready',
       '{"includes":["runtime"],"excludes":["production"]}',
       '[{"type":"work.plan","description":"bounded review submission","required":true}]',
       '["Runtime report persisted"]','["backend"]','{}','{"maxTokens":12000,"maxToolCalls":10}',0,$6,$6)`,
    [taskId, orgId, goalId, ownerId, reviewerAgentId, now],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES
       ($1,$5,'system','scheduler','task.claim','allow','{}','human',$6,0,$7),
       ($2,$5,'system','runtime-manager','task_run.prepare','allow','{}','human',$6,0,$7),
       ($3,$5,'system','runtime-manager','task_run.start','allow','{}','human',$6,0,$7),
       ($4,$5,'system','runtime-manager','task_run.finish','allow','{}','human',$6,0,$7),
       ($8,$5,'agent',$9,'task.submit_review','allow','{}','human',$6,0,$7)`,
    [
      `per_${ulid(121)}`,
      `per_${ulid(122)}`,
      `per_${ulid(123)}`,
      `per_${ulid(124)}`,
      orgId,
      ownerId,
      now,
      `per_${ulid(125)}`,
      workerAgentId,
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

describeDb("Runtime Manager PostgreSQL control plane", () => {
  it("executes prepare -> start -> exact Context -> bounded review command -> finish/report", async () => {
    if (pool === undefined) return;
    const commandGateway = gateway();
    await claimTask(commandGateway);

    const adapter = new ReviewSubmittingAdapter();
    const manager = new RuntimeManager(
      new PostgresRuntimeContextProvider(new PostgresContextManifestStore(pool, () => now)),
      new GatewayKernelRuntimePort(
        commandGateway,
        new PostgresRuntimeExecutionStateReader(pool),
        runtimeCommandIds(),
        () => now,
      ),
      adapter,
      () => now,
    );

    const report = await manager.execute({
      organizationId: orgId,
      runId,
      agent: workerAgent,
      manifestId,
      maxContextTokens: 12_000,
      policy: {
        allowedCommandTypes: ["task.submit_review"],
        allowedToolCapabilities: [],
        maxOutputTokens: 200,
        maxToolCalls: 2,
      },
    });

    expect(adapter.prepareInputs).toHaveLength(1);
    expect(adapter.prepareInputs[0]).not.toHaveProperty("context");
    expect(adapter.startInputs).toHaveLength(1);
    expect(adapter.startInputs[0]?.context.id).toBe(manifestId);
    expect(adapter.startInputs[0]?.context.taskRevision).toBe(2);
    expect(report.status).toBe("succeeded");
    expect(report.contextManifestId).toBe(manifestId);
    expect(report.commandOutcomes).toHaveLength(1);
    expect(report.commandOutcomes[0]).toMatchObject({ proposalIndex: 0, forwarded: true, result: { ok: true } });

    expect((await pool.query("SELECT state, revision FROM aop.tasks WHERE id=$1", [taskId])).rows[0]).toEqual({
      state: "review",
      revision: "3",
    });
    expect((await pool.query("SELECT status, revision FROM aop.task_runs WHERE id=$1", [runId])).rows[0]).toEqual({
      status: "succeeded",
      revision: "3",
    });
    expect((await pool.query("SELECT status, revision FROM aop.leases WHERE id=$1", [leaseId])).rows[0]).toEqual({
      status: "released",
      revision: "1",
    });
    expect((await pool.query("SELECT result, reviewer_id FROM aop.reviews WHERE id=$1", [reviewId])).rows[0]).toEqual({
      result: "pending",
      reviewer_id: reviewerAgentId,
    });
    expect((await pool.query("SELECT task_revision FROM aop.context_manifests WHERE id=$1", [manifestId])).rows[0]).toEqual({
      task_revision: "2",
    });

    const reportRow = (
      await pool.query(
        `SELECT schema_version, protocol_version, organization_id, task_id, run_id, agent_id, attempt,
                context_manifest_id, runtime_id, adapter, provider, model, status, usage, trace_refs,
                command_outcomes, failure_reason, started_at, finished_at, created_at
           FROM aop.runtime_run_reports WHERE organization_id=$1 AND run_id=$2`,
        [orgId, runId],
      )
    ).rows[0];
    const persistedReport = RuntimeRunReportSchema.parse({
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
      ...(reportRow?.failure_reason == null ? {} : { failureReason: reportRow.failure_reason }),
      startedAt: new Date(reportRow?.started_at).toISOString(),
      finishedAt: new Date(reportRow?.finished_at).toISOString(),
      createdAt: new Date(reportRow?.created_at).toISOString(),
    });
    expect(persistedReport.contextManifestId).toBe(manifestId);
    expect(persistedReport.commandOutcomes).toEqual([
      expect.objectContaining({ proposalIndex: 0, commandType: "task.submit_review", status: "accepted" }),
    ]);
  });
});

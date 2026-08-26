import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  CommandGateway,
  TaskClaimHandler,
  TaskCreateHandler,
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
import { GatewayKernelRuntimePort, RuntimeManager } from "@aop/runtime";
import {
  OpenAIRuntimeAdapter,
  createOpenAIModelPolicyResolver,
  type OpenAIModelTransport,
  type OpenAIModelTransportRequest,
  type OpenAIModelTransportResponse,
} from "@aop/runtime-openai";

import { PostgresRuntimeContextProvider } from "./runtime-context-provider.js";
import { PostgresRuntimeExecutionStateReader } from "./runtime-control-state.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(141)}` as const;
const ownerId = `usr_${ulid(141)}`;
const ctoAgentId = `agt_${ulid(141)}` as const;
const backendAgentId = `agt_${ulid(142)}` as const;
const qaAgentId = `agt_${ulid(143)}` as const;
const ctoRoleId = `rol_${ulid(141)}`;
const backendRoleId = `rol_${ulid(142)}`;
const qaRoleId = `rol_${ulid(143)}`;
const goalId = `gol_${ulid(141)}`;
const parentTaskId = `tsk_${ulid(141)}` as const;
const childTaskId = `tsk_${ulid(142)}` as const;
const runId = `run_${ulid(141)}` as const;
const leaseId = `lea_${ulid(141)}`;
const manifestId = `ctx_${ulid(141)}` as const;
const reviewId = `rev_${ulid(141)}` as const;
const now = "2026-08-26T04:30:00.000Z";
const joinedAt = "2026-08-26T04:00:00.000Z";

const ctoAgent: Agent = {
  id: ctoAgentId,
  name: "CTO",
  version: "0.1.0",
  description: "Decomposes one engineering Work Contract through bounded AOP Commands",
  capabilities: ["planning", "task.create", "task.submit_review"],
  runtime: { adapter: "runtime.openai", provider: "openai", modelPolicy: "cto" },
  revision: 0,
  createdAt: joinedAt,
  updatedAt: joinedAt,
};

function gatewayIds(): GatewayIds {
  let event = 14_100;
  let approval = 14_100;
  return {
    nextEventId: () => `evt_${ulid(++event)}` as EventId,
    nextApprovalRequestId: () => `apr_${ulid(++approval)}` as ApprovalRequestId,
  };
}

function runtimeCommandIds() {
  let command = 14_500;
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
      new TaskCreateHandler(() => now),
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

async function claimParent(commandGateway: CommandGateway): Promise<void> {
  const result = await commandGateway.execute(
    CommandEnvelopeSchema.parse({
      schemaVersion: 1,
      protocolVersion: AOP_PROTOCOL_VERSION,
      commandId: `cmd_${ulid(14_101)}` as CommandId,
      type: "task.claim",
      organizationId: orgId,
      actor: { type: "system", id: "scheduler" },
      target: { type: "task", id: parentTaskId },
      expectedRevision: 0,
      idempotencyKey: `cto-openai-e2e:${runId}:claim`,
      payload: {
        agentId: ctoAgentId,
        runId,
        leaseId,
        attempt: 1,
        runtimeType: "runtime.openai",
        workspaceId: "cto-openai-e2e-workspace",
        leaseSeconds: 600,
        heartbeatIntervalSeconds: 30,
      },
      issuedAt: now,
    }),
  );
  expect(result.ok).toBe(true);
}

class CTOFakeOpenAITransport implements OpenAIModelTransport {
  readonly requests: OpenAIModelTransportRequest[] = [];

  async execute(input: OpenAIModelTransportRequest): Promise<OpenAIModelTransportResponse> {
    this.requests.push(input);
    if (!input.input.includes(manifestId)) throw new Error("OpenAI input omitted exact Context Manifest identity");
    if (!input.input.includes(`\"taskRevision\":2`)) throw new Error("OpenAI input omitted running Task revision 2");
    if (!input.input.includes(parentTaskId)) throw new Error("OpenAI input omitted parent Work Contract");
    if (!input.instructions.includes("do not have direct authority to mutate organizational state")) {
      throw new Error("OpenAI instructions omitted Kernel authority boundary");
    }

    return {
      responseId: "resp_cto_decomposition_e2e",
      requestId: "req_cto_decomposition_e2e",
      inputTokens: 420,
      outputTokens: 160,
      output: {
        status: "succeeded",
        outputJson: JSON.stringify({ summary: "Created Backend child Work Contract and submitted parent for QA" }),
        failureReason: null,
        commandProposals: [
          {
            type: "task.create",
            targetType: "task",
            targetId: parentTaskId,
            expectedRevision: 2,
            payloadJson: JSON.stringify({
              taskId: childTaskId,
              title: "Implement authentication API",
              objective: "Implement the bounded authentication API child Work Contract",
              ownerAgentId: backendAgentId,
              reviewerAgentId: qaAgentId,
              priority: "high",
              scope: { includes: ["authentication API"], excludes: ["production deployment"] },
              inputs: [],
              deliverables: [
                { type: "code.patch", description: "Authentication API implementation", required: true },
              ],
              acceptanceCriteria: ["Automated tests pass", "Independent QA review passes"],
              requiredCapabilities: ["backend"],
              constraints: { maxFiles: 12 },
              budget: { maxTokens: 8_000, maxToolCalls: 12 },
              dependencies: [],
            }),
          },
          {
            type: "task.submit_review",
            targetType: "task",
            targetId: parentTaskId,
            expectedRevision: 2,
            payloadJson: JSON.stringify({
              reviewId,
              criteria: [
                {
                  key: "decomposition.valid",
                  description: "Child Work Contract is bounded and assigned to independent execution and QA Agents",
                  required: true,
                },
              ],
            }),
          },
        ],
      },
    };
  }
}

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.runtime_run_reports WHERE organization_id=$1", [orgId]);
  await pool.query("DELETE FROM aop.context_manifests WHERE organization_id=$1", [orgId]);
  await pool.query("DELETE FROM aop.leases WHERE organization_id=$1", [orgId]);
  await pool.query("DELETE FROM aop.task_runs WHERE organization_id=$1", [orgId]);
  await pool.query("DELETE FROM aop.organizations WHERE id=$1", [orgId]);
  await pool.query("DELETE FROM aop.agents WHERE id = ANY($1::text[])", [[ctoAgentId, backendAgentId, qaAgentId]]);
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES ($1,'CTO OpenAI E2E Org','company','active','Prove bounded CTO decomposition','human',$2,'assistant_managed',0,$3,$3)`,
    [orgId, ownerId, joinedAt],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES
       ($1,'CTO','0.1.0','Decomposes engineering work','["planning","task.create","task.submit_review"]','{"adapter":"runtime.openai","provider":"openai","modelPolicy":"cto"}',0,$4,$4),
       ($2,'Backend Engineer','0.1.0','Implements backend Work Contracts','["backend","task.submit_review"]','{"adapter":"runtime.openai","provider":"openai","modelPolicy":"engineering"}',0,$4,$4),
       ($3,'QA Reviewer','0.1.0','Reviews engineering Work Contracts','["qa","review.resolve"]','{"adapter":"runtime.openai","provider":"openai","modelPolicy":"qa"}',0,$4,$4)`,
    [ctoAgentId, backendAgentId, qaAgentId, joinedAt],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision) VALUES
       ($1,$4,$5,'active',$8,0),
       ($2,$4,$6,'active',$8,0),
       ($3,$4,$7,'active',$8,0)`,
    [
      `mem_${ulid(141)}`,
      `mem_${ulid(142)}`,
      `mem_${ulid(143)}`,
      orgId,
      ctoAgentId,
      backendAgentId,
      qaAgentId,
      joinedAt,
    ],
  );
  await pool.query(
    `INSERT INTO aop.roles (
       id, organization_id, name, purpose, responsibilities, authority, revision, created_at, updated_at
     ) VALUES
       ($1,$4,'CTO','Decompose engineering goals','["Create bounded child Work Contracts","Submit decomposition for review"]','{"allowedCapabilities":["task.create","task.submit_review"],"approvalRequiredCapabilities":[],"deniedCapabilities":["permission.grant"]}',0,$5,$5),
       ($2,$4,'Backend Engineer','Implement backend Work Contracts','["Implement backend work"]','{"allowedCapabilities":["task.submit_review"],"approvalRequiredCapabilities":[],"deniedCapabilities":[]}',0,$5,$5),
       ($3,$4,'QA Reviewer','Review engineering Work Contracts','["Resolve independent QA reviews"]','{"allowedCapabilities":["review.resolve"],"approvalRequiredCapabilities":[],"deniedCapabilities":[]}',0,$5,$5)`,
    [ctoRoleId, backendRoleId, qaRoleId, orgId, joinedAt],
  );
  await pool.query(
    `INSERT INTO aop.role_assignments (organization_id, agent_id, role_id, active_from) VALUES
       ($1,$2,$3,$8),
       ($1,$4,$5,$8),
       ($1,$6,$7,$8)`,
    [orgId, ctoAgentId, ctoRoleId, backendAgentId, backendRoleId, qaAgentId, qaRoleId, joinedAt],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Ship authenticated MVP','Produce a verified authentication vertical slice','human',$3,'["Backend child Work Contract exists","Parent decomposition passes QA"]','critical','active',0,$4,$4)`,
    [goalId, orgId, ownerId, joinedAt],
  );
  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       reviewer_agent_id, priority, state, scope, deliverables, acceptance_criteria,
       required_capabilities, constraints, budget, revision, created_at, updated_at
     ) VALUES ($1,$2,$3,'Decompose authentication MVP','Create a bounded Backend Work Contract and submit the decomposition for independent QA','human',$4,$5,'critical','ready',
       '{"includes":["engineering decomposition"],"excludes":["direct implementation","production deployment"]}',
       '[{"type":"work.plan","description":"Bounded engineering child Work Contract","required":true}]',
       '["Child task is bounded","Backend and QA responsibilities are separated"]','["planning"]','{}','{"maxTokens":12000,"maxToolCalls":10}',0,$6,$6)`,
    [parentTaskId, orgId, goalId, ownerId, qaAgentId, joinedAt],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       resource_type, resource_id, conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES
       ($1,$7,'system','scheduler','task.claim','allow',NULL,NULL,'{}','human',$8,0,$9),
       ($2,$7,'system','runtime-manager','task_run.prepare','allow',NULL,NULL,'{}','human',$8,0,$9),
       ($3,$7,'system','runtime-manager','task_run.start','allow',NULL,NULL,'{}','human',$8,0,$9),
       ($4,$7,'system','runtime-manager','task_run.finish','allow',NULL,NULL,'{}','human',$8,0,$9),
       ($5,$7,'agent',$10,'task.create','allow','task',$11,'{}','human',$8,0,$9),
       ($6,$7,'agent',$10,'task.submit_review','allow','task',$11,'{}','human',$8,0,$9)`,
    [
      `per_${ulid(141)}`,
      `per_${ulid(142)}`,
      `per_${ulid(143)}`,
      `per_${ulid(144)}`,
      `per_${ulid(145)}`,
      `per_${ulid(146)}`,
      orgId,
      ownerId,
      joinedAt,
      ctoAgentId,
      parentTaskId,
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

describeDb("CTO OpenAI bounded decomposition control plane", () => {
  it("executes exact Context -> task.create -> task.submit_review -> finish with two accepted Kernel outcomes", async () => {
    if (pool === undefined) return;
    const commandGateway = gateway();
    await claimParent(commandGateway);

    const transport = new CTOFakeOpenAITransport();
    const adapter = new OpenAIRuntimeAdapter({
      transport,
      modelResolver: createOpenAIModelPolicyResolver({ cto: "gpt-test-cto" }),
      runtimeIdFactory: () => "openai-runtime-cto-e2e",
    });
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
      agent: ctoAgent,
      manifestId,
      maxContextTokens: 12_000,
      policy: {
        allowedCommandTypes: ["task.create", "task.submit_review"],
        allowedToolCapabilities: [],
        maxOutputTokens: 500,
        maxToolCalls: 0,
      },
    });

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.model).toBe("gpt-test-cto");
    expect(report.status).toBe("succeeded");
    expect(report.contextManifestId).toBe(manifestId);
    expect(report.commandOutcomes).toHaveLength(2);
    expect(report.commandOutcomes.map((outcome) => outcome.proposal.type)).toEqual([
      "task.create",
      "task.submit_review",
    ]);
    expect(report.commandOutcomes.every((outcome) => outcome.forwarded && outcome.result?.ok === true)).toBe(true);

    expect(
      (await pool.query(
        `SELECT goal_id, state, created_by_type, created_by_id, owner_agent_id, reviewer_agent_id,
                required_capabilities, revision
           FROM aop.tasks WHERE organization_id=$1 AND id=$2`,
        [orgId, childTaskId],
      )).rows[0],
    ).toEqual({
      goal_id: goalId,
      state: "ready",
      created_by_type: "agent",
      created_by_id: ctoAgentId,
      owner_agent_id: backendAgentId,
      reviewer_agent_id: qaAgentId,
      required_capabilities: ["backend"],
      revision: "0",
    });
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
    expect((await pool.query("SELECT state, revision FROM aop.tasks WHERE id=$1", [parentTaskId])).rows[0]).toEqual({
      state: "review",
      revision: "3",
    });
    expect((await pool.query("SELECT result, reviewer_id FROM aop.reviews WHERE id=$1", [reviewId])).rows[0]).toEqual({
      result: "pending",
      reviewer_id: qaAgentId,
    });
    expect((await pool.query("SELECT task_revision FROM aop.context_manifests WHERE id=$1", [manifestId])).rows[0]).toEqual({
      task_revision: "2",
    });
    expect((await pool.query("SELECT status, revision FROM aop.task_runs WHERE id=$1", [runId])).rows[0]).toEqual({
      status: "succeeded",
      revision: "3",
    });
    expect((await pool.query("SELECT status, revision FROM aop.leases WHERE id=$1", [leaseId])).rows[0]).toEqual({
      status: "released",
      revision: "1",
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
    const persisted = RuntimeRunReportSchema.parse({
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
    expect(persisted.adapter).toBe("runtime.openai");
    expect(persisted.provider).toBe("openai");
    expect(persisted.model).toBe("gpt-test-cto");
    expect(persisted.commandOutcomes).toEqual([
      expect.objectContaining({ proposalIndex: 0, commandType: "task.create", status: "accepted" }),
      expect.objectContaining({ proposalIndex: 1, commandType: "task.submit_review", status: "accepted" }),
    ]);
  });
});

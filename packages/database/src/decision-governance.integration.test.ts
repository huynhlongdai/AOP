import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  CommandGateway,
  DecisionActivateHandler,
  DecisionCreateHandler,
  DecisionRejectHandler,
  DecisionRequestApprovalHandler,
  semanticCommandDigest,
  type GatewayIds,
} from "@aop/command-bus";
import {
  AOP_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  type ApprovalRequestId,
  type CommandEnvelope,
  type DecisionId,
  type EventId,
} from "@aop/protocol";

import { PostgresAuthorizationResolver } from "./postgres-command-store.js";
import { PostgresDecisionCommandStore } from "./postgres-decision-command-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(71)}`;
const ownerId = `usr_${ulid(71)}`;
const genericActivatorId = `usr_${ulid(72)}`;
const goalId = `gol_${ulid(71)}`;
const decisionA = `dec_${ulid(71)}` as DecisionId;
const decisionB = `dec_${ulid(72)}` as DecisionId;
const decisionC = `dec_${ulid(73)}` as DecisionId;
const now = "2026-08-25T14:30:00.000Z";
const authorityCapability = "decision.architecture.approve";

function ids(): GatewayIds {
  let event = 2_100;
  let approval = 2_100;
  return {
    nextEventId: () => `evt_${ulid(++event)}` as EventId,
    nextApprovalRequestId: () => `apr_${ulid(++approval)}` as ApprovalRequestId,
  };
}

function gateway(): CommandGateway {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  return new CommandGateway({
    store: new PostgresDecisionCommandStore(pool),
    authorization: new PostgresAuthorizationResolver(() => now),
    handlers: [
      new DecisionCreateHandler(() => now),
      new DecisionRequestApprovalHandler(() => now),
      new DecisionActivateHandler(() => now),
      new DecisionRejectHandler(() => now),
    ],
    ids: ids(),
    digest: semanticCommandDigest,
    now: () => now,
  });
}

function createCommand(
  decisionId: DecisionId,
  suffix: number,
  supersedesDecisionId?: DecisionId,
): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(2_200 + suffix)}`,
    type: "decision.create",
    organizationId: orgId,
    actor: { type: "human", id: ownerId },
    idempotencyKey: `decision.create.${suffix}`,
    payload: {
      decisionId,
      scope: "engineering.architecture",
      question: "Which authentication contract should the company adopt?",
      options: [
        { id: "jwt", label: "JWT access and refresh tokens" },
        { id: "session", label: "Server-side session" },
      ],
      authorityCapability,
      affectedResources: [{ type: "goal", id: goalId }],
      ...(supersedesDecisionId === undefined ? {} : { supersedesDecisionId }),
    },
    issuedAt: now,
  });
}

function requestApprovalCommand(decisionId: DecisionId, suffix: number, expectedRevision = 0): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(2_300 + suffix)}`,
    type: "decision.request_approval",
    organizationId: orgId,
    actor: { type: "human", id: ownerId },
    target: { type: "decision", id: decisionId },
    expectedRevision,
    idempotencyKey: `decision.request-approval.${decisionId}.${suffix}`,
    payload: {},
    issuedAt: now,
  });
}

function activateCommand(
  decisionId: DecisionId,
  suffix: number,
  actorId = ownerId,
  expectedRevision = 1,
): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(2_400 + suffix)}`,
    type: "decision.activate",
    organizationId: orgId,
    actor: { type: "human", id: actorId },
    target: { type: "decision", id: decisionId },
    expectedRevision,
    idempotencyKey: `decision.activate.${decisionId}.${actorId}.${suffix}`,
    payload: {
      selectedOptionId: "jwt",
      rationale: "JWT keeps the first software-company scenario stateless and testable.",
    },
    issuedAt: now,
  });
}

function rejectCommand(decisionId: DecisionId, suffix: number, actorId = ownerId): CommandEnvelope {
  return CommandEnvelopeSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(2_500 + suffix)}`,
    type: "decision.reject",
    organizationId: orgId,
    actor: { type: "human", id: actorId },
    target: { type: "decision", id: decisionId },
    expectedRevision: 1,
    idempotencyKey: `decision.reject.${decisionId}.${actorId}.${suffix}`,
    payload: {},
    issuedAt: now,
  });
}

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [orgId]);
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES ($1,'Decision Governance Org','company','active','Validate bounded organizational decisions','human',$2,'human_managed',0,$3,$3)`,
    [orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Choose architecture','Select an authoritative auth contract','human',$3,'["decision active"]','critical','active',0,$4,$4)`,
    [goalId, orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.permissions (
       id, organization_id, principal_type, principal_id, capability, effect,
       conditions, granted_by_type, granted_by_id, revision, created_at
     ) VALUES
       ($1,$8,'human',$9,'decision.create','allow','{}','human',$9,0,$11),
       ($2,$8,'human',$9,'decision.request_approval','allow','{}','human',$9,0,$11),
       ($3,$8,'human',$9,'decision.activate','allow','{}','human',$9,0,$11),
       ($4,$8,'human',$9,'decision.reject','allow','{}','human',$9,0,$11),
       ($5,$8,'human',$9,$12,'allow','{}','human',$9,0,$11),
       ($6,$8,'human',$10,'decision.activate','allow','{}','human',$9,0,$11),
       ($7,$8,'human',$10,'decision.reject','allow','{}','human',$9,0,$11)`,
    [
      `per_${ulid(71)}`,
      `per_${ulid(72)}`,
      `per_${ulid(73)}`,
      `per_${ulid(74)}`,
      `per_${ulid(75)}`,
      `per_${ulid(76)}`,
      `per_${ulid(77)}`,
      orgId,
      ownerId,
      genericActivatorId,
      now,
      authorityCapability,
    ],
  );
}

async function createAndRequest(bus: CommandGateway, decisionId: DecisionId, suffix: number, supersedes?: DecisionId) {
  expect((await bus.execute(createCommand(decisionId, suffix, supersedes))).ok).toBe(true);
  expect((await bus.execute(requestApprovalCommand(decisionId, suffix))).ok).toBe(true);
}

async function createRequestAndActivate(bus: CommandGateway, decisionId: DecisionId, suffix: number) {
  await createAndRequest(bus, decisionId, suffix);
  expect((await bus.execute(activateCommand(decisionId, suffix))).ok).toBe(true);
}

beforeEach(async () => {
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await pool?.end();
});

describeDb("PostgreSQL Decision authority and supersession", () => {
  it("creates, requests approval, and activates only with recorded authority evidence", async () => {
    if (pool === undefined) return;
    const bus = gateway();

    expect((await bus.execute(createCommand(decisionA, 1))).ok).toBe(true);
    expect(
      (await pool.query("SELECT status, revision FROM aop.decisions WHERE organization_id = $1 AND id = $2", [orgId, decisionA]))
        .rows[0],
    ).toEqual({ status: "proposed", revision: "0" });

    expect((await bus.execute(requestApprovalCommand(decisionA, 2))).ok).toBe(true);
    expect((await bus.execute(activateCommand(decisionA, 3))).ok).toBe(true);

    const active = (
      await pool.query(
        `SELECT status, revision, selected_option_id, approved_by_type, approved_by_id,
                effective_at IS NOT NULL AS effective
           FROM aop.decisions
          WHERE organization_id = $1 AND id = $2`,
        [orgId, decisionA],
      )
    ).rows[0];
    expect(active).toEqual({
      status: "active",
      revision: "2",
      selected_option_id: "jwt",
      approved_by_type: "human",
      approved_by_id: ownerId,
      effective: true,
    });

    const events = await pool.query(
      "SELECT type FROM aop.events WHERE organization_id = $1 ORDER BY organization_sequence",
      [orgId],
    );
    expect(events.rows.map((row) => row.type)).toEqual([
      "decision.proposed",
      "decision.approval_requested",
      "decision.activated",
    ]);
    expect((await pool.query("SELECT count(*)::int AS count FROM aop.outbox_events WHERE organization_id = $1", [orgId])).rows[0])
      .toEqual({ count: 3 });
  });

  it("denies a generic activator that lacks the Decision authority capability", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    await createAndRequest(bus, decisionA, 10);

    const result = await bus.execute(activateCommand(decisionA, 11, genericActivatorId));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");

    expect(
      (await pool.query("SELECT status, revision, approved_by_id FROM aop.decisions WHERE organization_id = $1 AND id = $2", [orgId, decisionA]))
        .rows[0],
    ).toEqual({ status: "approval_pending", revision: "1", approved_by_id: null });
  });

  it("rejects stale revisions without partially activating the Decision", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    await createAndRequest(bus, decisionA, 20);

    const result = await bus.execute(activateCommand(decisionA, 21, ownerId, 0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("revision_conflict");

    expect(
      (await pool.query("SELECT status, revision FROM aop.decisions WHERE organization_id = $1 AND id = $2", [orgId, decisionA]))
        .rows[0],
    ).toEqual({ status: "approval_pending", revision: "1" });
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM aop.events WHERE organization_id = $1 AND type = 'decision.activated'", [orgId]))
        .rows[0],
    ).toEqual({ count: 0 });
  });

  it("atomically activates a replacement and preserves the superseded Decision history", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    await createRequestAndActivate(bus, decisionA, 30);
    await createAndRequest(bus, decisionB, 31, decisionA);

    const result = await bus.execute(activateCommand(decisionB, 32));
    expect(result.ok).toBe(true);

    const decisions = await pool.query(
      `SELECT id, status, revision, selected_option_id, approved_by_id
         FROM aop.decisions
        WHERE organization_id = $1 AND id = ANY($2::text[])
        ORDER BY id`,
      [orgId, [decisionA, decisionB]],
    );
    expect(decisions.rows).toEqual([
      { id: decisionA, status: "superseded", revision: "3", selected_option_id: "jwt", approved_by_id: ownerId },
      { id: decisionB, status: "active", revision: "2", selected_option_id: "jwt", approved_by_id: ownerId },
    ]);

    expect(
      (
        await pool.query(
          `SELECT decision_id, resource_type, resource_id, impact_type
             FROM aop.decision_impacts
            WHERE organization_id = $1 AND decision_id = $2 AND impact_type = 'supersedes'`,
          [orgId, decisionB],
        )
      ).rows[0],
    ).toEqual({
      decision_id: decisionB,
      resource_type: "decision",
      resource_id: decisionA,
      impact_type: "supersedes",
    });
  });

  it("allows only one concurrent replacement to supersede the same active Decision", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    await createRequestAndActivate(bus, decisionA, 40);
    await createAndRequest(bus, decisionB, 41, decisionA);
    await createAndRequest(bus, decisionC, 42, decisionA);

    const [left, right] = await Promise.all([
      bus.execute(activateCommand(decisionB, 43)),
      bus.execute(activateCommand(decisionC, 44)),
    ]);
    expect([left.ok, right.ok].filter(Boolean)).toHaveLength(1);
    const loser = left.ok ? right : left;
    if (!loser.ok) expect(loser.error.code).toBe("invariant_violation");

    const original = (
      await pool.query("SELECT status, revision FROM aop.decisions WHERE organization_id = $1 AND id = $2", [orgId, decisionA])
    ).rows[0];
    expect(original).toEqual({ status: "superseded", revision: "3" });

    const replacements = await pool.query(
      `SELECT id, status, revision
         FROM aop.decisions
        WHERE organization_id = $1 AND id = ANY($2::text[])
        ORDER BY id`,
      [orgId, [decisionB, decisionC]],
    );
    expect(replacements.rows.filter((row) => row.status === "active")).toHaveLength(1);
    expect(replacements.rows.filter((row) => row.status === "approval_pending")).toHaveLength(1);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count
             FROM aop.decision_impacts
            WHERE organization_id = $1 AND resource_type = 'decision' AND resource_id = $2 AND impact_type = 'supersedes'`,
          [orgId, decisionA],
        )
      ).rows[0],
    ).toEqual({ count: 1 });
  });

  it("requires the same dynamic authority boundary when rejecting a pending Decision", async () => {
    if (pool === undefined) return;
    const bus = gateway();
    await createAndRequest(bus, decisionA, 50);

    const denied = await bus.execute(rejectCommand(decisionA, 51, genericActivatorId));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("forbidden");

    const allowed = await bus.execute(rejectCommand(decisionA, 52, ownerId));
    expect(allowed.ok).toBe(true);
    expect(
      (await pool.query("SELECT status, revision FROM aop.decisions WHERE organization_id = $1 AND id = $2", [orgId, decisionA]))
        .rows[0],
    ).toEqual({ status: "rejected", revision: "2" });
  });
});

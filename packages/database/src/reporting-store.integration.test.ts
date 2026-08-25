import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type { OrganizationId } from "@aop/protocol";

import { PostgresReportingStore } from "./reporting-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");

const orgId = `org_${ulid(81)}` as OrganizationId;
const ownerId = `usr_${ulid(81)}`;
const workerId = `agt_${ulid(81)}`;
const reviewerId = `agt_${ulid(82)}`;
const goalId = `gol_${ulid(81)}`;
const completedTaskId = `tsk_${ulid(81)}`;
const runningTaskId = `tsk_${ulid(82)}`;
const blockedTaskId = `tsk_${ulid(83)}`;
const reviewTaskId = `tsk_${ulid(84)}`;
const reworkTaskId = `tsk_${ulid(85)}`;
const cancelledTaskId = `tsk_${ulid(86)}`;
const completedRunId = `run_${ulid(81)}`;
const runningRunId = `run_${ulid(82)}`;
const lostRunId = `run_${ulid(83)}`;
const completedLeaseId = `lea_${ulid(81)}`;
const runningLeaseId = `lea_${ulid(82)}`;
const expiredLeaseId = `lea_${ulid(83)}`;
const passReviewId = `rev_${ulid(81)}`;
const pendingReviewId = `rev_${ulid(82)}`;
const reworkReviewId = `rev_${ulid(83)}`;
const activeDecisionId = `dec_${ulid(81)}`;
const pendingDecisionId = `dec_${ulid(82)}`;
const supersededDecisionId = `dec_${ulid(83)}`;
const artifactId = `art_${ulid(81)}`;
const staleVersionId = `arv_${ulid(81)}`;
const currentVersionId = `arv_${ulid(82)}`;
const completedArtifactId = `art_${ulid(82)}`;
const completedBaseVersionId = `arv_${ulid(83)}`;
const completedNextVersionId = `arv_${ulid(84)}`;
const now = "2026-08-25T15:00:00.000Z";
const later = "2026-08-25T15:05:00.000Z";
const checksum = (digit: string) => `sha256:${digit.repeat(64)}`;

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.leases WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM aop.task_runs WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [orgId]);
  await pool.query("DELETE FROM aop.agents WHERE id = ANY($1::text[])", [[workerId, reviewerId]]);
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");

  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id, autonomy_level,
       revision, created_at, updated_at
     ) VALUES ($1,'Reporting Org','company','active','Compute verified progress','human',$2,'human_managed',0,$3,$3)`,
    [orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.agents (
       id, name, version, description, capabilities, runtime, revision, created_at, updated_at
     ) VALUES
       ($1,'Worker','0.1.0','Executes work','["backend"]','{"adapter":"runtime.test"}',0,$3,$3),
       ($2,'Reviewer','0.1.0','Reviews work','["qa"]','{"adapter":"runtime.test"}',0,$3,$3)`,
    [workerId, reviewerId, now],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision) VALUES
       ($1,$3,$4,'active',$5,0),
       ($2,$3,$6,'active',$5,0)`,
    [`mem_${ulid(81)}`, `mem_${ulid(82)}`, orgId, workerId, now, reviewerId],
  );
  await pool.query(
    `INSERT INTO aop.goals (
       id, organization_id, title, objective, owner_type, owner_id, success_criteria,
       priority, status, revision, created_at, updated_at
     ) VALUES ($1,$2,'Ship verified system','Report only authoritative progress','human',$3,'["verified report"]','critical','active',0,$4,$4)`,
    [goalId, orgId, ownerId, now],
  );

  const commonTask = `
    '{"includes":["reporting"],"excludes":[]}',
    '[{"type":"code.patch","description":"implementation","required":true}]',
    '["verified"]','["backend"]','{}','{}'`;

  await pool.query(
    `INSERT INTO aop.tasks (
       id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
       owner_agent_id, reviewer_agent_id, priority, state, scope, deliverables,
       acceptance_criteria, required_capabilities, constraints, budget,
       block_reason, block_detail, blocked_since, revision, created_at, updated_at
     ) VALUES
       ($1,$7,$8,'Completed','Verified completed task','human',$9,$10,$11,'high','review',${commonTask},NULL,NULL,NULL,1,$12,$12),
       ($2,$7,$8,'Running','Currently executing','human',$9,$10,$11,'high','running',${commonTask},NULL,NULL,NULL,1,$12,$12),
       ($3,$7,$8,'Blocked','Waiting on governance','human',$9,$10,$11,'critical','blocked',${commonTask},'decision','Architecture decision required',$12,1,$12,$12),
       ($4,$7,$8,'In review','Waiting for QA','human',$9,$10,$11,'high','review',${commonTask},NULL,NULL,NULL,1,$12,$12),
       ($5,$7,$8,'Rework ready','QA requested changes','human',$9,$10,$11,'high','ready',${commonTask},NULL,NULL,NULL,2,$12,$12),
       ($6,$7,$8,'Cancelled','Removed from scope','human',$9,$10,$11,'low','cancelled',${commonTask},NULL,NULL,NULL,1,$12,$12)`,
    [
      completedTaskId,
      runningTaskId,
      blockedTaskId,
      reviewTaskId,
      reworkTaskId,
      cancelledTaskId,
      orgId,
      goalId,
      ownerId,
      workerId,
      reviewerId,
      now,
    ],
  );

  await pool.query(
    `INSERT INTO aop.task_runs (
       id, organization_id, task_id, agent_id, attempt, status, runtime_type,
       runtime_id, workspace_id, started_at, heartbeat_at, finished_at, failure_reason, revision
     ) VALUES
       ($1,$4,$5,$6,1,'succeeded','runtime.test','runtime-completed','workspace-completed',$7,$7,$7,NULL,1),
       ($2,$4,$8,$6,1,'running','runtime.test','runtime-running','workspace-running',$7,$7,NULL,NULL,1),
       ($3,$4,$9,$6,1,'lost','runtime.test','runtime-lost','workspace-lost',$7,$7,$7,'lease expired',1)`,
    [completedRunId, runningRunId, lostRunId, orgId, completedTaskId, workerId, now, runningTaskId, blockedTaskId],
  );
  await pool.query(
    `INSERT INTO aop.leases (
       id, organization_id, task_id, run_id, agent_id, status, attempt,
       acquired_at, expires_at, heartbeat_interval_seconds, revision
     ) VALUES
       ($1,$4,$5,$6,$7,'released',1,$8,$9,30,1),
       ($2,$4,$10,$11,$7,'active',1,$8,$9,30,1),
       ($3,$4,$12,$13,$7,'expired',1,$8,$9,30,1)`,
    [
      completedLeaseId,
      runningLeaseId,
      expiredLeaseId,
      orgId,
      completedTaskId,
      completedRunId,
      workerId,
      now,
      "2026-08-25T15:10:00.000Z",
      runningTaskId,
      runningRunId,
      blockedTaskId,
      lostRunId,
    ],
  );

  await pool.query(
    `INSERT INTO aop.reviews (
       id, organization_id, subject_type, subject_id, reviewer_type, reviewer_id,
       criteria, evidence, result, findings, created_at, completed_at, revision
     ) VALUES
       ($1,$4,'task',$5,'agent',$6,'[{"key":"qa.pass","description":"QA pass","required":true}]',$7::jsonb,'pass','[]',$8,$8,1),
       ($2,$4,'task',$9,'agent',$6,'[{"key":"qa.pass","description":"QA pass","required":true}]','[]','pending','[]',$8,NULL,0),
       ($3,$4,'task',$10,'agent',$6,'[{"key":"qa.pass","description":"QA pass","required":true}]','[]','rework','["fix contract"]',$8,$8,1)`,
    [
      passReviewId,
      pendingReviewId,
      reworkReviewId,
      orgId,
      completedTaskId,
      reviewerId,
      JSON.stringify([{ type: "task_run", id: completedRunId }]),
      now,
      reviewTaskId,
      reworkTaskId,
    ],
  );

  await pool.query(
    `INSERT INTO aop.decisions (
       id, organization_id, scope, question, options, selected_option_id, rationale,
       proposed_by_type, proposed_by_id, authority_capability, status,
       approved_by_type, approved_by_id, effective_at, revision, created_at, updated_at
     ) VALUES
       ($1,$4,'engineering.architecture','Active choice','[{"id":"a","label":"A"}]','a','Approved choice','human',$5,'decision.architecture.approve','active','human',$5,$6,2,$6,$6),
       ($2,$4,'engineering.architecture','Pending choice','[{"id":"a","label":"A"}]',NULL,NULL,'human',$5,'decision.architecture.approve','approval_pending',NULL,NULL,NULL,1,$6,$6),
       ($3,$4,'engineering.architecture','Historical choice','[{"id":"a","label":"A"}]','a','Historical choice','human',$5,'decision.architecture.approve','superseded','human',$5,$6,3,$6,$6)`,
    [activeDecisionId, pendingDecisionId, supersededDecisionId, orgId, ownerId, now],
  );
  await pool.query(
    `INSERT INTO aop.decision_impacts (
       organization_id, decision_id, resource_type, resource_id, impact_type, detail, created_at
     ) VALUES ($1,$2,'task',$3,'blocks','Task waits for this pending architecture decision',$4)`,
    [orgId, pendingDecisionId, blockedTaskId, now],
  );

  // Artifact A is already superseded and proves current stale-work reporting.
  await pool.query(
    `INSERT INTO aop.artifacts (
       id, organization_id, type, title, current_approved_version_id, revision, created_at, updated_at
     ) VALUES ($1,$2,'api.spec','Auth contract',NULL,0,$3,$3)`,
    [artifactId, orgId, now],
  );
  await pool.query(
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
      workerId,
      `aop://${orgId}/artifacts/${artifactId}/versions/${staleVersionId}`,
      checksum("1"),
      reviewerId,
      now,
      `aop://${orgId}/artifacts/${artifactId}/versions/${currentVersionId}`,
      checksum("2"),
    ],
  );
  await pool.query(
    `UPDATE aop.artifacts
        SET current_approved_version_id = $3, revision = 1, updated_at = $4
      WHERE organization_id = $1 AND id = $2`,
    [orgId, artifactId, currentVersionId, now],
  );
  await pool.query(
    `INSERT INTO aop.task_artifact_inputs (organization_id, task_id, artifact_version_id, required, created_at)
     VALUES ($1,$2,$3,true,$4)`,
    [orgId, runningTaskId, staleVersionId, now],
  );

  // Artifact B is current when the completed Task is reviewed and completed.
  // A regression test later supersedes it to prove verified progress is revoked.
  await pool.query(
    `INSERT INTO aop.artifacts (
       id, organization_id, type, title, current_approved_version_id, revision, created_at, updated_at
     ) VALUES ($1,$2,'requirements.spec','Completion contract',NULL,0,$3,$3)`,
    [completedArtifactId, orgId, now],
  );
  await pool.query(
    `INSERT INTO aop.artifact_versions (
       id, organization_id, artifact_id, version, status, created_by_type, created_by_id,
       content_uri, mime_type, checksum, size_bytes, approved_by_type, approved_by_id, approved_at, created_at
     ) VALUES ($1,$2,$3,1,'approved','agent',$4,$5,'application/json',$6,80,'agent',$7,$8,$8)`,
    [
      completedBaseVersionId,
      orgId,
      completedArtifactId,
      workerId,
      `aop://${orgId}/artifacts/${completedArtifactId}/versions/${completedBaseVersionId}`,
      checksum("3"),
      reviewerId,
      now,
    ],
  );
  await pool.query(
    `UPDATE aop.artifacts
        SET current_approved_version_id = $3, revision = 1, updated_at = $4
      WHERE organization_id = $1 AND id = $2`,
    [orgId, completedArtifactId, completedBaseVersionId, now],
  );
  await pool.query(
    `INSERT INTO aop.task_artifact_inputs (organization_id, task_id, artifact_version_id, required, created_at)
     VALUES ($1,$2,$3,true,$4)`,
    [orgId, completedTaskId, completedBaseVersionId, now],
  );

  // Completion occurs while all required inputs are current, so the DB
  // completion guard accepts the matching passing Review.
  await pool.query(
    `UPDATE aop.tasks
        SET state = 'completed', completed_at = $3, revision = 2, updated_at = $3
      WHERE organization_id = $1 AND id = $2`,
    [orgId, completedTaskId, now],
  );

  await pool.query(
    `INSERT INTO aop.events (
       id, organization_id, organization_sequence, schema_version, protocol_version,
       type, aggregate_type, aggregate_id, aggregate_revision, actor_type, actor_id,
       correlation_id, payload, occurred_at
     ) VALUES
       ($1,$4,1,1,'0.1.0','task.updated','task',$5,1,'human',$6,'report-fixture','{}',$7),
       ($2,$4,2,1,'0.1.0','decision.activated','decision',$8,2,'human',$6,'report-fixture','{}',$7),
       ($3,$4,3,1,'0.1.0','review.resolved','review',$9,1,'human',$6,'report-fixture','{}',$7)`,
    [
      `evt_${ulid(81)}`,
      `evt_${ulid(82)}`,
      `evt_${ulid(83)}`,
      orgId,
      runningTaskId,
      ownerId,
      now,
      activeDecisionId,
      passReviewId,
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

describeDb("PostgreSQL verified organizational reporting", () => {
  it("derives exact progress, governance, runtime and stale-work state from authoritative tables", async () => {
    if (pool === undefined) return;
    const report = await new PostgresReportingStore(pool, () => now).getOrganizationReport(orgId);

    expect(report).toEqual({
      organizationId: orgId,
      generatedAt: now,
      latestEventSequence: 3,
      tasks: {
        proposed: 0,
        ready: 1,
        leased: 0,
        running: 1,
        blocked: 1,
        review: 1,
        completed: 1,
        failed: 0,
        cancelled: 1,
        rejected: 0,
      },
      taskRuns: {
        created: 0,
        preparing: 0,
        running: 1,
        paused: 0,
        succeeded: 1,
        failed: 0,
        lost: 1,
        cancelled: 0,
      },
      leases: { active: 1, expired: 1, released: 1 },
      decisions: {
        proposed: 0,
        discussion: 0,
        approvalPending: 1,
        active: 1,
        rejected: 0,
        superseded: 1,
      },
      reviews: { pending: 1, pass: 1, rework: 1, fail: 0 },
      artifacts: { total: 2, withCurrentApprovedVersion: 2, staleConsumerLinks: 1 },
      verifiedProgress: {
        eligibleTasks: 5,
        verifiedCompletedTasks: 1,
        staleCompletedTasks: 0,
        ratio: 0.2,
      },
      blockers: {
        blockedTaskIds: [blockedTaskId],
        staleInputTaskIds: [runningTaskId],
        blockingDecisionIds: [pendingDecisionId],
      },
      attention: {
        pendingDecisionIds: [pendingDecisionId],
        reworkReviewIds: [reworkReviewId],
      },
    });
  });

  it("reconciles immediately when a stale consumer link is removed", async () => {
    if (pool === undefined) return;
    const store = new PostgresReportingStore(pool, () => now);
    expect((await store.getOrganizationReport(orgId))?.artifacts.staleConsumerLinks).toBe(1);

    await pool.query(
      "DELETE FROM aop.task_artifact_inputs WHERE organization_id = $1 AND task_id = $2 AND artifact_version_id = $3",
      [orgId, runningTaskId, staleVersionId],
    );

    const report = await store.getOrganizationReport(orgId);
    expect(report?.artifacts.staleConsumerLinks).toBe(0);
    expect(report?.blockers.staleInputTaskIds).toEqual([]);
  });

  it("revokes verified progress when an input becomes stale after Task completion", async () => {
    if (pool === undefined) return;
    const store = new PostgresReportingStore(pool, () => now);
    expect((await store.getOrganizationReport(orgId))?.verifiedProgress).toEqual({
      eligibleTasks: 5,
      verifiedCompletedTasks: 1,
      staleCompletedTasks: 0,
      ratio: 0.2,
    });

    await pool.query(
      `INSERT INTO aop.artifact_versions (
         id, organization_id, artifact_id, version, status, created_by_type, created_by_id,
         content_uri, mime_type, checksum, size_bytes, supersedes_version_id,
         approved_by_type, approved_by_id, approved_at, created_at
       ) VALUES ($1,$2,$3,2,'approved','agent',$4,$5,'application/json',$6,90,$7,'agent',$8,$9,$9)`,
      [
        completedNextVersionId,
        orgId,
        completedArtifactId,
        workerId,
        `aop://${orgId}/artifacts/${completedArtifactId}/versions/${completedNextVersionId}`,
        checksum("4"),
        completedBaseVersionId,
        reviewerId,
        later,
      ],
    );
    await pool.query(
      `UPDATE aop.artifact_versions
          SET status = 'superseded'
        WHERE organization_id = $1 AND artifact_id = $2 AND id = $3`,
      [orgId, completedArtifactId, completedBaseVersionId],
    );
    await pool.query(
      `UPDATE aop.artifacts
          SET current_approved_version_id = $3, revision = 2, updated_at = $4
        WHERE organization_id = $1 AND id = $2`,
      [orgId, completedArtifactId, completedNextVersionId, later],
    );

    const report = await store.getOrganizationReport(orgId);
    expect(report?.tasks.completed).toBe(1);
    expect(report?.verifiedProgress).toEqual({
      eligibleTasks: 5,
      verifiedCompletedTasks: 0,
      staleCompletedTasks: 1,
      ratio: 0,
    });
    expect(report?.artifacts.staleConsumerLinks).toBe(2);
    expect(report?.blockers.staleInputTaskIds).toEqual([completedTaskId, runningTaskId]);
  });

  it("returns undefined instead of fabricating a report for an unknown Organization", async () => {
    if (pool === undefined) return;
    const missing = `org_${ulid(99)}` as OrganizationId;
    expect(await new PostgresReportingStore(pool, () => now).getOrganizationReport(missing)).toBeUndefined();
  });
});

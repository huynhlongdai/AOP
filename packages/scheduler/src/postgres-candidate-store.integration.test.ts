import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { PostgresSchedulerCandidateStore } from "./postgres-candidate-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;
const pool = DATABASE_URL === undefined ? undefined : new Pool({ connectionString: DATABASE_URL });
const ulid = (value: number) => String(value).padStart(26, "0");
const orgId = `org_${ulid(31)}`;
const userId = `usr_${ulid(31)}`;
const agentId = `agt_${ulid(31)}`;
const goalId = `gol_${ulid(31)}`;
const taskHighId = `tsk_${ulid(31)}`;
const taskLowId = `tsk_${ulid(32)}`;
const taskBlockedId = `tsk_${ulid(33)}`;
const now = "2026-08-25T08:10:00.000Z";

async function cleanup(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [orgId]);
  await pool.query("DELETE FROM aop.agents WHERE id = $1", [agentId]);
}

async function seed(): Promise<void> {
  if (pool === undefined) throw new Error("DATABASE_URL missing");
  await pool.query(
    `INSERT INTO aop.organizations
      (id,name,type,status,owner_type,owner_id,autonomy_level,revision,created_at,updated_at)
     VALUES ($1,'Candidate Org','company','active','human',$2,'human_managed',0,$3,$3)`,
    [orgId, userId, now],
  );
  await pool.query(
    `INSERT INTO aop.agents
      (id,name,version,capabilities,runtime,revision,created_at,updated_at)
     VALUES ($1,'Candidate Agent','0.1.0','["backend","api"]','{"adapter":"runtime.test"}',0,$2,$2)`,
    [agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.organization_memberships (id,organization_id,agent_id,status,joined_at,revision)
     VALUES ($1,$2,$3,'active',$4,0)`,
    [`mem_${ulid(31)}`, orgId, agentId, now],
  );
  await pool.query(
    `INSERT INTO aop.roles
      (id,organization_id,name,purpose,responsibilities,authority,revision,created_at,updated_at)
     VALUES ($1,$2,'Engineer','Execute work','[]','{"allowedCapabilities":[],"approvalRequiredCapabilities":[],"deniedCapabilities":[]}',0,$3,$3)`,
    [`rol_${ulid(31)}`, orgId, now],
  );
  await pool.query(
    `INSERT INTO aop.role_assignments (organization_id,agent_id,role_id,active_from)
     VALUES ($1,$2,$3,$4)`,
    [orgId, agentId, `rol_${ulid(31)}`, now],
  );
  await pool.query(
    `INSERT INTO aop.goals
      (id,organization_id,title,objective,owner_type,owner_id,success_criteria,priority,status,revision,created_at,updated_at)
     VALUES ($1,$2,'Goal','Deliver','human',$3,'["done"]','high','active',0,$4,$4)`,
    [goalId, orgId, userId, now],
  );

  const insertTask = async (id: string, priority: string, required: string) =>
    pool.query(
      `INSERT INTO aop.tasks
        (id,organization_id,goal_id,title,objective,created_by_type,created_by_id,priority,state,scope,
         deliverables,acceptance_criteria,required_capabilities,constraints,budget,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'Work','human',$5,$6,'ready','{"includes":["work"],"excludes":[]}',
         '[{"type":"code","description":"code","required":true}]','["verified"]',$7::jsonb,'{}','{}',0,$8,$8)`,
      [id, orgId, goalId, `Task ${id.slice(-2)}`, userId, priority, JSON.stringify([required]), now],
    );
  await insertTask(taskHighId, "critical", "backend");
  await insertTask(taskLowId, "low", "backend");
  await insertTask(taskBlockedId, "high", "backend");
  await pool.query(
    `INSERT INTO aop.task_dependencies (organization_id,task_id,depends_on_task_id,dependency_type)
     VALUES ($1,$2,$3,'hard')`,
    [orgId, taskBlockedId, taskLowId],
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

describeDb("PostgresSchedulerCandidateStore", () => {
  it("orders ready work deterministically and excludes hard-blocked tasks", async () => {
    if (pool === undefined) return;
    const candidates = await new PostgresSchedulerCandidateStore(pool).listCandidates(10, now);
    expect(candidates.map((candidate) => candidate.taskId)).toEqual([taskHighId, taskLowId]);
    expect(candidates[0]).toMatchObject({ agentId, runtimeType: "runtime.test", attempt: 1, taskRevision: 0 });
  });

  it("excludes the agent after v0 capacity is consumed", async () => {
    if (pool === undefined) return;
    await pool.query(
      `INSERT INTO aop.task_runs
        (id,organization_id,task_id,agent_id,attempt,status,runtime_type,workspace_id,revision)
       VALUES ($1,$2,$3,$4,1,'created','runtime.test','capacity-test',0)`,
      [`run_${ulid(31)}`, orgId, taskHighId, agentId],
    );
    await pool.query(
      `INSERT INTO aop.leases
        (id,organization_id,task_id,run_id,agent_id,status,attempt,acquired_at,expires_at,heartbeat_interval_seconds,revision)
       VALUES ($1,$2,$3,$4,$5,'active',1,$6,$7,60,0)`,
      [
        `lea_${ulid(31)}`,
        orgId,
        taskHighId,
        `run_${ulid(31)}`,
        agentId,
        now,
        "2026-08-25T08:15:00.000Z",
      ],
    );
    const candidates = await new PostgresSchedulerCandidateStore(pool).listCandidates(10, now);
    expect(candidates).toEqual([]);
  });

  it("requires an active role assignment and capability match", async () => {
    if (pool === undefined) return;
    await pool.query("DELETE FROM aop.role_assignments WHERE organization_id = $1", [orgId]);
    expect(await new PostgresSchedulerCandidateStore(pool).listCandidates(10, now)).toEqual([]);

    await pool.query(
      `INSERT INTO aop.role_assignments (organization_id,agent_id,role_id,active_from)
       VALUES ($1,$2,$3,$4)`,
      [orgId, agentId, `rol_${ulid(31)}`, now],
    );
    await pool.query("UPDATE aop.agents SET capabilities = '[\"frontend\"]'::jsonb WHERE id = $1", [agentId]);
    expect(await new PostgresSchedulerCandidateStore(pool).listCandidates(10, now)).toEqual([]);
  });
});

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM aop.schema_migrations) <> 13 THEN
    RAISE EXCEPTION 'expected 13 applied migrations';
  END IF;
END $$;

INSERT INTO aop.organizations (
  id, name, type, status, mission, owner_type, owner_id,
  autonomy_level, revision, created_at, updated_at
) VALUES
  ('org_00000000000000000000000001', 'Org One', 'company', 'active', 'Test org one', 'human', 'usr_00000000000000000000000001', 'human_managed', 0, now(), now()),
  ('org_00000000000000000000000002', 'Org Two', 'company', 'active', 'Test org two', 'human', 'usr_00000000000000000000000002', 'human_managed', 0, now(), now());

INSERT INTO aop.agents (id, name, version, description, capabilities, runtime, revision, created_at, updated_at) VALUES
  ('agt_00000000000000000000000001', 'Backend Agent', '0.1.0', 'Test worker', '["backend"]', '{"adapter":"test"}', 0, now(), now()),
  ('agt_00000000000000000000000002', 'Other Agent', '0.1.0', 'Other worker', '["backend"]', '{"adapter":"test"}', 0, now(), now());

INSERT INTO aop.organization_memberships (id, organization_id, agent_id, status, joined_at, revision) VALUES
  ('mem_00000000000000000000000001', 'org_00000000000000000000000001', 'agt_00000000000000000000000001', 'active', now(), 0),
  ('mem_00000000000000000000000002', 'org_00000000000000000000000002', 'agt_00000000000000000000000002', 'active', now(), 0);

INSERT INTO aop.goals (
  id, organization_id, title, objective, owner_type, owner_id, success_criteria,
  priority, status, revision, created_at, updated_at
) VALUES
  ('gol_00000000000000000000000001', 'org_00000000000000000000000001', 'Goal One', 'Validate org one', 'human', 'usr_00000000000000000000000001', '["passes"]', 'high', 'active', 0, now(), now()),
  ('gol_00000000000000000000000002', 'org_00000000000000000000000002', 'Goal Two', 'Validate org two', 'human', 'usr_00000000000000000000000002', '["passes"]', 'high', 'active', 0, now(), now());

INSERT INTO aop.tasks (
  id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
  owner_agent_id, priority, state, scope, deliverables, acceptance_criteria,
  required_capabilities, constraints, budget, revision, created_at, updated_at
) VALUES (
  'tsk_00000000000000000000000001', 'org_00000000000000000000000001', 'gol_00000000000000000000000001',
  'Implement auth API', 'Implement bounded authentication', 'human', 'usr_00000000000000000000000001',
  'agt_00000000000000000000000001', 'high', 'ready',
  '{"includes":["api"],"excludes":[]}',
  '[{"type":"code","description":"implementation","required":true}]',
  '["tests pass"]', '["backend"]', '{}', '{}', 0, now(), now()
);

-- Cross-organization Goal reference must fail.
DO $$
BEGIN
  BEGIN
    INSERT INTO aop.tasks (
      id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
      priority, state, scope, deliverables, acceptance_criteria,
      required_capabilities, constraints, budget, revision, created_at, updated_at
    ) VALUES (
      'tsk_00000000000000000000000002', 'org_00000000000000000000000001', 'gol_00000000000000000000000002',
      'Bad task', 'Must fail', 'human', 'usr_00000000000000000000000001',
      'medium', 'ready', '{"includes":[],"excludes":[]}',
      '[{"type":"code","description":"bad","required":true}]', '["must fail"]', '[]', '{}', '{}', 0, now(), now()
    );
    RAISE EXCEPTION 'cross-org Goal FK was not enforced';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;

-- Cross-organization owner membership must fail when deferred constraints are checked.
DO $$
BEGIN
  BEGIN
    SET CONSTRAINTS ALL DEFERRED;
    UPDATE aop.tasks
       SET owner_agent_id = 'agt_00000000000000000000000002'
     WHERE id = 'tsk_00000000000000000000000001';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'cross-org Task owner FK was not enforced';
  EXCEPTION WHEN foreign_key_violation THEN
    UPDATE aop.tasks
       SET owner_agent_id = 'agt_00000000000000000000000001'
     WHERE id = 'tsk_00000000000000000000000001';
    SET CONSTRAINTS ALL IMMEDIATE;
  END;
END $$;

ROLLBACK;

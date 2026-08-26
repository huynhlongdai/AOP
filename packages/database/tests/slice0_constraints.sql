\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM aop.schema_migrations) <> 15 THEN
    RAISE EXCEPTION 'expected 15 applied migrations';
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
  '{"includes":["auth"],"excludes":[]}', '[{"type":"code","description":"implementation","required":true}]',
  '["tests pass"]', '["backend"]', '{}', '{}', 0, now(), now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.tasks (
      id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
      priority, state, scope, deliverables, acceptance_criteria, required_capabilities,
      constraints, budget, revision, created_at, updated_at
    ) VALUES (
      'tsk_00000000000000000000000002', 'org_00000000000000000000000001', 'gol_00000000000000000000000002',
      'Invalid cross-org task', 'Must fail', 'human', 'usr_00000000000000000000000001',
      'medium', 'ready', '{}', '[{"type":"code"}]', '["never persists"]', '[]', '{}', '{}', 0, now(), now()
    );
    RAISE EXCEPTION 'cross-org goal reference was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    UPDATE aop.tasks
       SET state = 'completed', completed_at = now(), revision = revision + 1
     WHERE organization_id = 'org_00000000000000000000000001'
       AND id = 'tsk_00000000000000000000000001';
    RAISE EXCEPTION 'task completion without passing review was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO aop.task_runs (
  id, organization_id, task_id, agent_id, attempt, status, runtime_type,
  workspace_id, revision
) VALUES (
  'run_00000000000000000000000001', 'org_00000000000000000000000001',
  'tsk_00000000000000000000000001', 'agt_00000000000000000000000001', 1,
  'created', 'runtime.test', 'workspace-1', 0
);

INSERT INTO aop.leases (
  id, organization_id, task_id, run_id, agent_id, status, attempt,
  acquired_at, expires_at, heartbeat_interval_seconds, revision
) VALUES (
  'lea_00000000000000000000000001', 'org_00000000000000000000000001',
  'tsk_00000000000000000000000001', 'run_00000000000000000000000001',
  'agt_00000000000000000000000001', 'active', 1, now(), now() + interval '5 minutes', 30, 0
);

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.leases (
      id, organization_id, task_id, run_id, agent_id, status, attempt,
      acquired_at, expires_at, heartbeat_interval_seconds, revision
    ) VALUES (
      'lea_00000000000000000000000002', 'org_00000000000000000000000001',
      'tsk_00000000000000000000000001', 'run_00000000000000000000000001',
      'agt_00000000000000000000000001', 'active', 1, now(), now() + interval '5 minutes', 30, 0
    );
    RAISE EXCEPTION 'dual active lease was incorrectly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO aop.leases (
      id, organization_id, task_id, run_id, agent_id, status, attempt,
      acquired_at, expires_at, heartbeat_interval_seconds, revision
    ) VALUES (
      'lea_00000000000000000000000003', 'org_00000000000000000000000001',
      'tsk_00000000000000000000000001', 'run_00000000000000000000000001',
      'agt_00000000000000000000000001', 'released', 2, now(), now() + interval '5 minutes', 30, 0
    );
    RAISE EXCEPTION 'mismatched lease attempt was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

INSERT INTO aop.decisions (
  id, organization_id, scope, question, options, selected_option_id, rationale,
  proposed_by_type, proposed_by_id, authority_capability, status,
  approved_by_type, approved_by_id, effective_at, revision, created_at, updated_at
) VALUES (
  'dec_00000000000000000000000001', 'org_00000000000000000000000001',
  'architecture', 'Which auth mechanism?', '[{"id":"a","label":"Option A"}]',
  'a', 'Approved rationale', 'human', 'usr_00000000000000000000000001',
  'decision.architecture.approve', 'active', 'human', 'usr_00000000000000000000000001', now(), 1, now(), now()
);

UPDATE aop.decisions
   SET status = 'superseded', revision = revision + 1, updated_at = now()
 WHERE id = 'dec_00000000000000000000000001';

DO $$
DECLARE
  approved_type text;
  approved_id text;
  effective timestamptz;
BEGIN
  SELECT approved_by_type, approved_by_id, effective_at
    INTO approved_type, approved_id, effective
    FROM aop.decisions
   WHERE id = 'dec_00000000000000000000000001';
  IF approved_type IS NULL OR approved_id IS NULL OR effective IS NULL THEN
    RAISE EXCEPTION 'superseded decision lost approval history';
  END IF;
END $$;

INSERT INTO aop.reviews (
  id, organization_id, subject_type, subject_id, reviewer_type, reviewer_id,
  criteria, evidence, result, findings, created_at, completed_at, revision
) VALUES (
  'rev_00000000000000000000000001', 'org_00000000000000000000000001',
  'task', 'tsk_00000000000000000000000001', 'human', 'usr_00000000000000000000000001',
  '[{"key":"tests","description":"Tests pass","required":true}]',
  '[{"type":"task_run","id":"run_00000000000000000000000001"}]',
  'pass', '[]', now(), now(), 0
);

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.reviews (
      id, organization_id, subject_type, subject_id, reviewer_type, reviewer_id,
      criteria, evidence, result, findings, created_at, completed_at, revision
    ) VALUES (
      'rev_00000000000000000000000002', 'org_00000000000000000000000001',
      'task', 'tsk_00000000000000000000000001', 'human', 'usr_00000000000000000000000001',
      '[{"key":"tests","description":"Tests pass","required":true}]',
      '[]', 'pass', '[]', now(), now(), 0
    );
    RAISE EXCEPTION 'passing review without evidence was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;

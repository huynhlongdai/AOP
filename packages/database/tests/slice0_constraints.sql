\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM aop.schema_migrations) <> 4 THEN
    RAISE EXCEPTION 'expected 4 applied migrations';
  END IF;
END $$;

INSERT INTO aop.organizations (
  id, name, type, status, mission, owner_type, owner_id, root_goal_id,
  autonomy_level, revision, created_at, updated_at
) VALUES
  ('org_00000000000000000000000001', 'Org One', 'company', 'active', 'Test org one', 'human', 'usr_00000000000000000000000001', NULL, 'human_managed', 0, now(), now()),
  ('org_00000000000000000000000002', 'Org Two', 'company', 'active', 'Test org two', 'human', 'usr_00000000000000000000000002', NULL, 'human_managed', 0, now(), now());

INSERT INTO aop.agents (
  id, name, version, description, capabilities, runtime, revision, created_at, updated_at
) VALUES
  ('agt_00000000000000000000000001', 'Backend Agent', '0.1.0', 'Test worker', '["backend"]'::jsonb, '{"provider":"test"}'::jsonb, 0, now(), now()),
  ('agt_00000000000000000000000002', 'Other Agent', '0.1.0', 'Other worker', '["backend"]'::jsonb, '{"provider":"test"}'::jsonb, 0, now(), now());

INSERT INTO aop.organization_memberships (
  id, organization_id, agent_id, status, joined_at, left_at, revision
) VALUES
  ('mem_00000000000000000000000001', 'org_00000000000000000000000001', 'agt_00000000000000000000000001', 'active', now(), NULL, 0),
  ('mem_00000000000000000000000002', 'org_00000000000000000000000002', 'agt_00000000000000000000000002', 'active', now(), NULL, 0);

INSERT INTO aop.goals (
  id, organization_id, parent_goal_id, title, objective, owner_type, owner_id,
  success_criteria, priority, status, revision, created_at, updated_at, completed_at
) VALUES
  ('gol_00000000000000000000000001', 'org_00000000000000000000000001', NULL, 'Goal One', 'Validate organization one', 'human', 'usr_00000000000000000000000001', '["passes"]'::jsonb, 'high', 'active', 0, now(), now(), NULL),
  ('gol_00000000000000000000000002', 'org_00000000000000000000000002', NULL, 'Goal Two', 'Validate organization two', 'human', 'usr_00000000000000000000000002', '["passes"]'::jsonb, 'high', 'active', 0, now(), now(), NULL);

INSERT INTO aop.tasks (
  id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
  owner_agent_id, reviewer_agent_id, priority, state, scope, deliverables,
  acceptance_criteria, required_capabilities, constraints, budget, revision,
  created_at, updated_at
) VALUES (
  'tsk_00000000000000000000000001',
  'org_00000000000000000000000001',
  'gol_00000000000000000000000001',
  'Implement auth API',
  'Implement the bounded authentication API',
  'human',
  'usr_00000000000000000000000001',
  'agt_00000000000000000000000001',
  NULL,
  'high',
  'ready',
  '{"includes":["auth"]}'::jsonb,
  '[{"type":"code"}]'::jsonb,
  '[{"criterion":"tests pass"}]'::jsonb,
  '["backend"]'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  0,
  now(),
  now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.tasks (
      id, organization_id, goal_id, title, objective, created_by_type, created_by_id,
      priority, state, scope, deliverables, acceptance_criteria, required_capabilities,
      constraints, budget, revision, created_at, updated_at
    ) VALUES (
      'tsk_00000000000000000000000002',
      'org_00000000000000000000000001',
      'gol_00000000000000000000000002',
      'Invalid cross-org task',
      'Must be rejected by same-org foreign key',
      'human',
      'usr_00000000000000000000000001',
      'medium',
      'ready',
      '{}'::jsonb,
      '[{"type":"code"}]'::jsonb,
      '[{"criterion":"never persists"}]'::jsonb,
      '[]'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      0,
      now(),
      now()
    );
    RAISE EXCEPTION 'cross-org goal reference was incorrectly accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END $$;

INSERT INTO aop.task_runs (
  id, organization_id, task_id, agent_id, attempt, status, runtime_type,
  runtime_id, workspace_id, started_at, heartbeat_at, revision
) VALUES (
  'run_00000000000000000000000001',
  'org_00000000000000000000000001',
  'tsk_00000000000000000000000001',
  'agt_00000000000000000000000001',
  1,
  'running',
  'test_runtime',
  'runtime-1',
  'workspace-1',
  now(),
  now(),
  0
);

INSERT INTO aop.leases (
  id, organization_id, task_id, run_id, agent_id, status, attempt,
  acquired_at, expires_at, heartbeat_interval_seconds, revision
) VALUES (
  'lea_00000000000000000000000001',
  'org_00000000000000000000000001',
  'tsk_00000000000000000000000001',
  'run_00000000000000000000000001',
  'agt_00000000000000000000000001',
  'active',
  1,
  now(),
  now() + interval '10 minutes',
  60,
  0
);

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.leases (
      id, organization_id, task_id, run_id, agent_id, status, attempt,
      acquired_at, expires_at, heartbeat_interval_seconds, revision
    ) VALUES (
      'lea_00000000000000000000000002',
      'org_00000000000000000000000001',
      'tsk_00000000000000000000000001',
      'run_00000000000000000000000001',
      'agt_00000000000000000000000001',
      'active',
      1,
      now(),
      now() + interval '10 minutes',
      60,
      0
    );
    RAISE EXCEPTION 'second active lease was incorrectly accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.leases (
      id, organization_id, task_id, run_id, agent_id, status, attempt,
      acquired_at, expires_at, heartbeat_interval_seconds, revision
    ) VALUES (
      'lea_00000000000000000000000003',
      'org_00000000000000000000000001',
      'tsk_00000000000000000000000001',
      'run_00000000000000000000000001',
      'agt_00000000000000000000000001',
      'released',
      2,
      now(),
      now() + interval '10 minutes',
      60,
      0
    );
    RAISE EXCEPTION 'lease with mismatched TaskRun attempt was incorrectly accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.decisions (
      id, organization_id, scope, question, options, selected_option_id, rationale,
      proposed_by_type, proposed_by_id, authority_capability, status,
      approved_by_type, approved_by_id, effective_at, revision, created_at, updated_at
    ) VALUES (
      'dec_00000000000000000000000001',
      'org_00000000000000000000000001',
      'engineering.architecture',
      'Which contract is authoritative?',
      '[{"id":"v4","label":"v4"}]'::jsonb,
      'v4',
      'Validated rationale',
      'human',
      'usr_00000000000000000000000001',
      'decision.engineering.approve',
      'superseded',
      NULL,
      NULL,
      NULL,
      2,
      now(),
      now()
    );
    RAISE EXCEPTION 'superseded decision without approval history was incorrectly accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.reviews (
      id, organization_id, subject_type, subject_id, reviewer_type, reviewer_id,
      criteria, evidence, result, findings, created_at, completed_at, revision
    ) VALUES (
      'rev_00000000000000000000000001',
      'org_00000000000000000000000001',
      'task',
      'tsk_00000000000000000000000001',
      'human',
      'usr_00000000000000000000000001',
      '[{"key":"tests.pass","description":"Tests pass","required":true}]'::jsonb,
      '[]'::jsonb,
      'pass',
      '[]'::jsonb,
      now(),
      now(),
      1
    );
    RAISE EXCEPTION 'passing review without evidence was incorrectly accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO aop.command_deduplication (
  organization_id, idempotency_key, command_id, command_type,
  actor_type, actor_id, request_digest, status, result
) VALUES (
  'org_00000000000000000000000001',
  'db-constraint-test-command',
  'cmd_00000000000000000000000001',
  'task.update',
  'human',
  'usr_00000000000000000000000001',
  'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  'accepted',
  '{"ok":true}'::jsonb
);

INSERT INTO aop.events (
  id, organization_id, organization_sequence, type, aggregate_type, aggregate_id,
  aggregate_revision, actor_type, actor_id, causation_id, correlation_id, payload, occurred_at
) VALUES (
  'evt_00000000000000000000000001',
  'org_00000000000000000000000001',
  1,
  'task.updated',
  'task',
  'tsk_00000000000000000000000001',
  1,
  'human',
  'usr_00000000000000000000000001',
  'cmd_00000000000000000000000001',
  'constraint-suite',
  '{}'::jsonb,
  now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.events (
      id, organization_id, organization_sequence, type, aggregate_type, aggregate_id,
      aggregate_revision, actor_type, actor_id, causation_id, correlation_id, payload, occurred_at
    ) VALUES (
      'evt_00000000000000000000000002',
      'org_00000000000000000000000001',
      1,
      'task.updated',
      'task',
      'tsk_00000000000000000000000001',
      1,
      'human',
      'usr_00000000000000000000000001',
      'cmd_00000000000000000000000001',
      'constraint-suite',
      '{}'::jsonb,
      now()
    );
    RAISE EXCEPTION 'duplicate organization event sequence was incorrectly accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END $$;

ROLLBACK;

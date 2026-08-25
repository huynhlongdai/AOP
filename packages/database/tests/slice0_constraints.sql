\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM aop.schema_migrations) <> 11 THEN
    RAISE EXCEPTION 'expected 11 applied migrations';
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
  runtime_id, workspace_id, started_at, heartbeat_at, revision
) VALUES (
  'run_00000000000000000000000001', 'org_00000000000000000000000001',
  'tsk_00000000000000000000000001', 'agt_00000000000000000000000001',
  1, 'running', 'test_runtime', 'runtime-1', 'workspace-1', now(), now(), 0
);

INSERT INTO aop.leases (
  id, organization_id, task_id, run_id, agent_id, status, attempt,
  acquired_at, expires_at, heartbeat_interval_seconds, revision
) VALUES (
  'lea_00000000000000000000000001', 'org_00000000000000000000000001',
  'tsk_00000000000000000000000001', 'run_00000000000000000000000001',
  'agt_00000000000000000000000001', 'active', 1, now(), now() + interval '10 minutes', 60, 0
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
      'agt_00000000000000000000000001', 'active', 1, now(), now() + interval '10 minutes', 60, 0
    );
    RAISE EXCEPTION 'second active lease was incorrectly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO aop.leases (
      id, organization_id, task_id, run_id, agent_id, status, attempt,
      acquired_at, expires_at, heartbeat_interval_seconds, revision
    ) VALUES (
      'lea_00000000000000000000000003', 'org_00000000000000000000000001',
      'tsk_00000000000000000000000001', 'run_00000000000000000000000001',
      'agt_00000000000000000000000001', 'released', 2, now(), now() + interval '10 minutes', 60, 0
    );
    RAISE EXCEPTION 'mismatched lease attempt was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.decisions (
      id, organization_id, scope, question, options, selected_option_id, rationale,
      proposed_by_type, proposed_by_id, authority_capability, status,
      revision, created_at, updated_at
    ) VALUES (
      'dec_00000000000000000000000001', 'org_00000000000000000000000001',
      'engineering.architecture', 'Which contract?', '[{"id":"v4","label":"v4"}]', 'v4', 'Historical rationale',
      'human', 'usr_00000000000000000000000001', 'decision.engineering.approve', 'superseded', 2, now(), now()
    );
    RAISE EXCEPTION 'superseded decision without approval history was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO aop.reviews (
      id, organization_id, subject_type, subject_id, reviewer_type, reviewer_id,
      criteria, evidence, result, findings, created_at, completed_at, revision
    ) VALUES (
      'rev_00000000000000000000000001', 'org_00000000000000000000000001',
      'task', 'tsk_00000000000000000000000001', 'human', 'usr_00000000000000000000000001',
      '[{"key":"tests.pass","description":"Tests pass","required":true}]', '[]', 'pass', '[]', now(), now(), 1
    );
    RAISE EXCEPTION 'passing review without evidence was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO aop.command_deduplication (
  organization_id, idempotency_key, command_id, command_type, actor_type, actor_id,
  request_digest, status, result
) VALUES (
  'org_00000000000000000000000001', 'db-constraint-test-command',
  'cmd_00000000000000000000000001', 'task.update', 'human', 'usr_00000000000000000000000001',
  'sha256:0000000000000000000000000000000000000000000000000000000000000000', 'accepted', '{"ok":true}'
);

INSERT INTO aop.events (
  id, organization_id, organization_sequence, schema_version, protocol_version,
  type, aggregate_type, aggregate_id, aggregate_revision, actor_type, actor_id,
  causation_id, correlation_id, payload, occurred_at
) VALUES (
  'evt_00000000000000000000000001', 'org_00000000000000000000000001', 1, 1, '0.1.0',
  'task.updated', 'task', 'tsk_00000000000000000000000001', 1,
  'human', 'usr_00000000000000000000000001', 'cmd_00000000000000000000000001',
  'constraint-suite', '{}', now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO aop.events (
      id, organization_id, organization_sequence, schema_version, protocol_version,
      type, aggregate_type, aggregate_id, aggregate_revision, actor_type, actor_id,
      causation_id, correlation_id, payload, occurred_at
    ) VALUES (
      'evt_00000000000000000000000002', 'org_00000000000000000000000001', 1, 1, '0.1.0',
      'task.updated', 'task', 'tsk_00000000000000000000000001', 1,
      'human', 'usr_00000000000000000000000001', 'cmd_00000000000000000000000001',
      'constraint-suite', '{}', now()
    );
    RAISE EXCEPTION 'duplicate organization event sequence was incorrectly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO aop.outbox_events (
      event_id, organization_id, status, locked_at, locked_by
    ) VALUES (
      'evt_00000000000000000000000001', 'org_00000000000000000000000001',
      'pending', now(), 'invalid-worker'
    );
    RAISE EXCEPTION 'pending outbox row with a processing lock was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;

BEGIN;

CREATE TABLE aop.tasks (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'tsk')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  goal_id text NOT NULL,
  title varchar(240) NOT NULL CHECK (length(btrim(title)) > 0),
  objective text NOT NULL CHECK (length(btrim(objective)) > 0 AND length(objective) <= 4000),
  created_by_type text NOT NULL CHECK (created_by_type IN ('human', 'agent', 'system')),
  created_by_id text NOT NULL,
  owner_agent_id text,
  reviewer_agent_id text,
  priority text NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  state text NOT NULL CHECK (state IN ('proposed', 'ready', 'leased', 'running', 'blocked', 'review', 'completed', 'failed', 'cancelled', 'rejected')),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  deliverables jsonb NOT NULL CHECK (jsonb_typeof(deliverables) = 'array' AND jsonb_array_length(deliverables) > 0),
  acceptance_criteria jsonb NOT NULL CHECK (jsonb_typeof(acceptance_criteria) = 'array' AND jsonb_array_length(acceptance_criteria) > 0),
  required_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_capabilities) = 'array'),
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(constraints) = 'object'),
  budget jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(budget) = 'object'),
  block_reason text CHECK (block_reason IS NULL OR block_reason IN ('dependency', 'human_input', 'external_system', 'resource', 'decision', 'capability_gap')),
  block_detail text CHECK (block_detail IS NULL OR length(block_detail) <= 1000),
  blocked_since timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT tasks_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT tasks_goal_same_org_fk FOREIGN KEY (organization_id, goal_id)
    REFERENCES aop.goals(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT tasks_owner_membership_fk FOREIGN KEY (organization_id, owner_agent_id)
    REFERENCES aop.organization_memberships(organization_id, agent_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT tasks_reviewer_membership_fk FOREIGN KEY (organization_id, reviewer_agent_id)
    REFERENCES aop.organization_memberships(organization_id, agent_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT tasks_creator_principal_check CHECK (
    (created_by_type = 'human' AND aop.is_prefixed_ulid(created_by_id, 'usr')) OR
    (created_by_type = 'agent' AND aop.is_prefixed_ulid(created_by_id, 'agt')) OR
    (created_by_type = 'system' AND created_by_id IN ('kernel', 'scheduler', 'runtime-manager', 'outbox-worker', 'observer'))
  ),
  CONSTRAINT tasks_block_shape_check CHECK (
    (state = 'blocked' AND block_reason IS NOT NULL AND block_detail IS NOT NULL AND blocked_since IS NOT NULL) OR
    (state <> 'blocked' AND block_reason IS NULL AND block_detail IS NULL AND blocked_since IS NULL)
  ),
  CONSTRAINT tasks_completed_at_check CHECK (
    (state = 'completed' AND completed_at IS NOT NULL) OR
    (state <> 'completed' AND completed_at IS NULL)
  )
);

CREATE TABLE aop.task_dependencies (
  organization_id text NOT NULL,
  task_id text NOT NULL,
  depends_on_task_id text NOT NULL,
  dependency_type text NOT NULL CHECK (dependency_type IN ('hard', 'soft', 'informational')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, task_id, depends_on_task_id),
  CONSTRAINT task_dependencies_not_self CHECK (task_id <> depends_on_task_id),
  CONSTRAINT task_dependencies_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES aop.tasks(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT task_dependencies_depends_on_fk FOREIGN KEY (organization_id, depends_on_task_id)
    REFERENCES aop.tasks(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE aop.task_runs (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'run')),
  organization_id text NOT NULL,
  task_id text NOT NULL,
  agent_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('created', 'preparing', 'running', 'paused', 'succeeded', 'failed', 'lost', 'cancelled')),
  runtime_type varchar(128) NOT NULL CHECK (runtime_type ~ '^[a-z][a-z0-9_.:-]+$'),
  runtime_id varchar(240),
  workspace_id varchar(240) NOT NULL CHECK (length(btrim(workspace_id)) > 0),
  snapshot_id varchar(240),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  failure_reason text CHECK (failure_reason IS NULL OR length(failure_reason) <= 2000),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  CONSTRAINT task_runs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT task_runs_attempt_unique UNIQUE (organization_id, task_id, attempt),
  CONSTRAINT task_runs_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES aop.tasks(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT task_runs_agent_membership_fk FOREIGN KEY (organization_id, agent_id)
    REFERENCES aop.organization_memberships(organization_id, agent_id)
    ON DELETE RESTRICT,
  CONSTRAINT task_runs_time_check CHECK (
    (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at) AND
    (heartbeat_at IS NULL OR started_at IS NULL OR heartbeat_at >= started_at)
  )
);

CREATE TABLE aop.leases (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'lea')),
  organization_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  agent_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'expired', 'released')),
  attempt integer NOT NULL CHECK (attempt > 0),
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  heartbeat_interval_seconds integer NOT NULL CHECK (heartbeat_interval_seconds > 0 AND heartbeat_interval_seconds <= 3600),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  CONSTRAINT leases_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT leases_time_check CHECK (expires_at > acquired_at),
  CONSTRAINT leases_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES aop.tasks(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT leases_run_fk FOREIGN KEY (organization_id, run_id)
    REFERENCES aop.task_runs(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT leases_agent_membership_fk FOREIGN KEY (organization_id, agent_id)
    REFERENCES aop.organization_memberships(organization_id, agent_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX leases_one_active_per_task_idx
  ON aop.leases (organization_id, task_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX leases_one_active_per_run_idx
  ON aop.leases (organization_id, run_id)
  WHERE status = 'active';

CREATE INDEX tasks_state_priority_idx
  ON aop.tasks (organization_id, state, priority, updated_at);

CREATE INDEX tasks_goal_state_idx
  ON aop.tasks (organization_id, goal_id, state);

CREATE INDEX tasks_owner_state_idx
  ON aop.tasks (organization_id, owner_agent_id, state)
  WHERE owner_agent_id IS NOT NULL;

CREATE INDEX task_dependencies_reverse_idx
  ON aop.task_dependencies (organization_id, depends_on_task_id, dependency_type);

CREATE INDEX task_runs_task_status_idx
  ON aop.task_runs (organization_id, task_id, status, attempt DESC);

CREATE INDEX task_runs_agent_status_idx
  ON aop.task_runs (organization_id, agent_id, status);

CREATE INDEX leases_expiry_idx
  ON aop.leases (expires_at)
  WHERE status = 'active';

INSERT INTO aop.schema_migrations(version)
VALUES ('0002_task_engine')
ON CONFLICT (version) DO NOTHING;

COMMIT;

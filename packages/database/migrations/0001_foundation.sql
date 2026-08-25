BEGIN;

CREATE SCHEMA IF NOT EXISTS aop;

CREATE TABLE IF NOT EXISTS aop.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION aop.is_prefixed_ulid(value text, prefix text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT value ~ ('^' || prefix || '_[0-9A-HJKMNP-TV-Z]{26}$');
$$;

CREATE TABLE aop.organizations (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'org')),
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  type text NOT NULL CHECK (type IN ('company', 'organization')),
  status text NOT NULL CHECK (status IN ('active', 'paused', 'closed')),
  mission text CHECK (mission IS NULL OR length(mission) <= 2000),
  owner_type text NOT NULL CHECK (owner_type IN ('human', 'agent', 'system')),
  owner_id text NOT NULL,
  root_goal_id text CHECK (root_goal_id IS NULL OR aop.is_prefixed_ulid(root_goal_id, 'gol')),
  autonomy_level text NOT NULL CHECK (autonomy_level IN ('human_managed', 'assistant_managed', 'ceo_autonomous', 'board_managed')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT organizations_owner_principal_check CHECK (
    (owner_type = 'human' AND aop.is_prefixed_ulid(owner_id, 'usr')) OR
    (owner_type = 'agent' AND aop.is_prefixed_ulid(owner_id, 'agt')) OR
    (owner_type = 'system' AND owner_id IN ('kernel', 'scheduler', 'runtime-manager', 'outbox-worker', 'observer'))
  )
);

CREATE TABLE aop.agents (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'agt')),
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  version varchar(120) NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$'),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capabilities) = 'array'),
  runtime jsonb NOT NULL CHECK (jsonb_typeof(runtime) = 'object'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE aop.organization_memberships (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'mem')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES aop.agents(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'left')),
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  CONSTRAINT membership_status_time_check CHECK (
    (status = 'left' AND left_at IS NOT NULL) OR
    (status <> 'left' AND left_at IS NULL)
  ),
  CONSTRAINT organization_memberships_org_agent_unique UNIQUE (organization_id, agent_id)
);

CREATE TABLE aop.roles (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'rol')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  purpose text NOT NULL CHECK (length(btrim(purpose)) > 0 AND length(purpose) <= 1000),
  reports_to_role_id text,
  responsibilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(responsibilities) = 'array'),
  authority jsonb NOT NULL CHECK (jsonb_typeof(authority) = 'object'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT roles_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT roles_not_self_reporting CHECK (reports_to_role_id IS NULL OR reports_to_role_id <> id),
  CONSTRAINT roles_reports_to_same_org_fk FOREIGN KEY (organization_id, reports_to_role_id)
    REFERENCES aop.roles(organization_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE aop.role_assignments (
  organization_id text NOT NULL,
  agent_id text NOT NULL,
  role_id text NOT NULL,
  manager_agent_id text,
  active_from timestamptz NOT NULL,
  active_until timestamptz,
  PRIMARY KEY (organization_id, agent_id, role_id, active_from),
  CONSTRAINT role_assignments_time_check CHECK (active_until IS NULL OR active_until > active_from),
  CONSTRAINT role_assignments_membership_fk FOREIGN KEY (organization_id, agent_id)
    REFERENCES aop.organization_memberships(organization_id, agent_id)
    ON DELETE CASCADE,
  CONSTRAINT role_assignments_role_fk FOREIGN KEY (organization_id, role_id)
    REFERENCES aop.roles(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT role_assignments_manager_membership_fk FOREIGN KEY (organization_id, manager_agent_id)
    REFERENCES aop.organization_memberships(organization_id, agent_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE aop.goals (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'gol')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  parent_goal_id text,
  title varchar(180) NOT NULL CHECK (length(btrim(title)) > 0),
  objective text NOT NULL CHECK (length(btrim(objective)) > 0 AND length(objective) <= 4000),
  owner_type text NOT NULL CHECK (owner_type IN ('human', 'agent', 'system')),
  owner_id text NOT NULL,
  success_criteria jsonb NOT NULL CHECK (jsonb_typeof(success_criteria) = 'array' AND jsonb_array_length(success_criteria) > 0),
  priority text NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status text NOT NULL CHECK (status IN ('planned', 'active', 'blocked', 'completed', 'cancelled')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT goals_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT goals_not_self_parent CHECK (parent_goal_id IS NULL OR parent_goal_id <> id),
  CONSTRAINT goals_completion_time_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT goals_owner_principal_check CHECK (
    (owner_type = 'human' AND aop.is_prefixed_ulid(owner_id, 'usr')) OR
    (owner_type = 'agent' AND aop.is_prefixed_ulid(owner_id, 'agt')) OR
    (owner_type = 'system' AND owner_id IN ('kernel', 'scheduler', 'runtime-manager', 'outbox-worker', 'observer'))
  ),
  CONSTRAINT goals_parent_same_org_fk FOREIGN KEY (organization_id, parent_goal_id)
    REFERENCES aop.goals(organization_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE aop.organizations
  ADD CONSTRAINT organizations_root_goal_fk
  FOREIGN KEY (id, root_goal_id)
  REFERENCES aop.goals(organization_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX organization_memberships_status_idx
  ON aop.organization_memberships (organization_id, status);

CREATE INDEX roles_reports_to_idx
  ON aop.roles (organization_id, reports_to_role_id)
  WHERE reports_to_role_id IS NOT NULL;

CREATE INDEX role_assignments_active_idx
  ON aop.role_assignments (organization_id, role_id, agent_id)
  WHERE active_until IS NULL;

CREATE INDEX goals_status_priority_idx
  ON aop.goals (organization_id, status, priority);

CREATE INDEX goals_parent_idx
  ON aop.goals (organization_id, parent_goal_id)
  WHERE parent_goal_id IS NOT NULL;

INSERT INTO aop.schema_migrations(version)
VALUES ('0001_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;

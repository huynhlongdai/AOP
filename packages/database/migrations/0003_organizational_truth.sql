BEGIN;

CREATE OR REPLACE FUNCTION aop.is_principal_ref(principal_type text, principal_id text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE principal_type
    WHEN 'human' THEN aop.is_prefixed_ulid(principal_id, 'usr')
    WHEN 'agent' THEN aop.is_prefixed_ulid(principal_id, 'agt')
    WHEN 'system' THEN principal_id IN ('kernel', 'scheduler', 'runtime-manager', 'outbox-worker', 'observer')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION aop.is_resource_ref(resource_type text, resource_id text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE resource_type
    WHEN 'organization' THEN aop.is_prefixed_ulid(resource_id, 'org')
    WHEN 'agent' THEN aop.is_prefixed_ulid(resource_id, 'agt')
    WHEN 'role' THEN aop.is_prefixed_ulid(resource_id, 'rol')
    WHEN 'goal' THEN aop.is_prefixed_ulid(resource_id, 'gol')
    WHEN 'task' THEN aop.is_prefixed_ulid(resource_id, 'tsk')
    WHEN 'task_run' THEN aop.is_prefixed_ulid(resource_id, 'run')
    WHEN 'lease' THEN aop.is_prefixed_ulid(resource_id, 'lea')
    WHEN 'artifact' THEN aop.is_prefixed_ulid(resource_id, 'art')
    WHEN 'artifact_version' THEN aop.is_prefixed_ulid(resource_id, 'arv')
    WHEN 'decision' THEN aop.is_prefixed_ulid(resource_id, 'dec')
    WHEN 'review' THEN aop.is_prefixed_ulid(resource_id, 'rev')
    WHEN 'permission' THEN aop.is_prefixed_ulid(resource_id, 'per')
    WHEN 'approval' THEN aop.is_prefixed_ulid(resource_id, 'apr')
    WHEN 'event' THEN aop.is_prefixed_ulid(resource_id, 'evt')
    WHEN 'command' THEN aop.is_prefixed_ulid(resource_id, 'cmd')
    WHEN 'context_manifest' THEN aop.is_prefixed_ulid(resource_id, 'ctx')
    ELSE false
  END;
$$;

CREATE TABLE aop.command_deduplication (
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  idempotency_key varchar(200) NOT NULL,
  command_id text NOT NULL CHECK (aop.is_prefixed_ulid(command_id, 'cmd')),
  command_type varchar(160) NOT NULL CHECK (command_type ~ '^[a-z][a-z0-9_.:-]+$'),
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_id text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('processing', 'approval_pending', 'accepted', 'rejected')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, idempotency_key),
  CONSTRAINT command_deduplication_org_command_unique UNIQUE (organization_id, command_id),
  CONSTRAINT command_deduplication_actor_check CHECK (aop.is_principal_ref(actor_type, actor_id))
);

CREATE TABLE aop.artifacts (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'art')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  type varchar(128) NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.:-]+$'),
  title varchar(240) NOT NULL CHECK (length(btrim(title)) > 0),
  current_approved_version_id text,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT artifacts_org_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE aop.artifact_versions (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'arv')),
  organization_id text NOT NULL,
  artifact_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'in_review', 'approved', 'superseded', 'rejected')),
  created_by_type text NOT NULL CHECK (created_by_type IN ('human', 'agent', 'system')),
  created_by_id text NOT NULL,
  produced_by_task_id text,
  content_uri text NOT NULL CHECK (length(btrim(content_uri)) > 0 AND length(content_uri) <= 2000),
  mime_type varchar(160) NOT NULL CHECK (length(btrim(mime_type)) > 0),
  checksum text NOT NULL CHECK (checksum ~ '^sha256:[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  content_schema varchar(240),
  supersedes_version_id text,
  approved_by_type text CHECK (approved_by_type IS NULL OR approved_by_type IN ('human', 'agent', 'system')),
  approved_by_id text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL,
  CONSTRAINT artifact_versions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT artifact_versions_artifact_version_unique UNIQUE (organization_id, artifact_id, version),
  CONSTRAINT artifact_versions_org_artifact_id_unique UNIQUE (organization_id, artifact_id, id),
  CONSTRAINT artifact_versions_artifact_fk FOREIGN KEY (organization_id, artifact_id)
    REFERENCES aop.artifacts(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT artifact_versions_task_fk FOREIGN KEY (organization_id, produced_by_task_id)
    REFERENCES aop.tasks(organization_id, id)
    ON DELETE SET NULL,
  CONSTRAINT artifact_versions_creator_check CHECK (aop.is_principal_ref(created_by_type, created_by_id)),
  CONSTRAINT artifact_versions_approval_shape_check CHECK (
    (
      status IN ('approved', 'superseded') AND
      approved_by_type IS NOT NULL AND approved_by_id IS NOT NULL AND approved_at IS NOT NULL AND
      aop.is_principal_ref(approved_by_type, approved_by_id)
    ) OR
    (
      status NOT IN ('approved', 'superseded') AND
      approved_by_type IS NULL AND approved_by_id IS NULL AND approved_at IS NULL
    )
  ),
  CONSTRAINT artifact_versions_not_self_supersede CHECK (supersedes_version_id IS NULL OR supersedes_version_id <> id),
  CONSTRAINT artifact_versions_supersedes_same_artifact_fk FOREIGN KEY (organization_id, artifact_id, supersedes_version_id)
    REFERENCES aop.artifact_versions(organization_id, artifact_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE aop.artifacts
  ADD CONSTRAINT artifacts_current_version_same_artifact_fk
  FOREIGN KEY (organization_id, id, current_approved_version_id)
  REFERENCES aop.artifact_versions(organization_id, artifact_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE aop.artifact_lineage (
  organization_id text NOT NULL,
  child_version_id text NOT NULL,
  parent_version_id text NOT NULL,
  relationship text NOT NULL CHECK (relationship IN ('derived_from', 'based_on')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, child_version_id, parent_version_id, relationship),
  CONSTRAINT artifact_lineage_not_self CHECK (child_version_id <> parent_version_id),
  CONSTRAINT artifact_lineage_child_fk FOREIGN KEY (organization_id, child_version_id)
    REFERENCES aop.artifact_versions(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT artifact_lineage_parent_fk FOREIGN KEY (organization_id, parent_version_id)
    REFERENCES aop.artifact_versions(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE aop.task_artifact_inputs (
  organization_id text NOT NULL,
  task_id text NOT NULL,
  artifact_version_id text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, task_id, artifact_version_id),
  CONSTRAINT task_artifact_inputs_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES aop.tasks(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT task_artifact_inputs_version_fk FOREIGN KEY (organization_id, artifact_version_id)
    REFERENCES aop.artifact_versions(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE aop.task_artifact_outputs (
  organization_id text NOT NULL,
  task_id text NOT NULL,
  artifact_version_id text NOT NULL,
  deliverable_type varchar(128) NOT NULL CHECK (deliverable_type ~ '^[a-z][a-z0-9_.:-]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, task_id, artifact_version_id),
  CONSTRAINT task_artifact_outputs_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES aop.tasks(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT task_artifact_outputs_version_fk FOREIGN KEY (organization_id, artifact_version_id)
    REFERENCES aop.artifact_versions(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE aop.decisions (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'dec')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  scope varchar(128) NOT NULL CHECK (scope ~ '^[a-z][a-z0-9_.:-]+$'),
  question text NOT NULL CHECK (length(btrim(question)) > 0 AND length(question) <= 4000),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) > 0),
  selected_option_id varchar(64),
  rationale text CHECK (rationale IS NULL OR length(rationale) <= 4000),
  proposed_by_type text NOT NULL CHECK (proposed_by_type IN ('human', 'agent', 'system')),
  proposed_by_id text NOT NULL,
  authority_capability varchar(128) NOT NULL CHECK (authority_capability ~ '^[a-z][a-z0-9_.:-]+$'),
  status text NOT NULL CHECK (status IN ('proposed', 'discussion', 'approval_pending', 'active', 'rejected', 'superseded')),
  approved_by_type text CHECK (approved_by_type IS NULL OR approved_by_type IN ('human', 'agent', 'system')),
  approved_by_id text,
  effective_at timestamptz,
  supersedes_decision_id text,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT decisions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT decisions_proposer_check CHECK (aop.is_principal_ref(proposed_by_type, proposed_by_id)),
  CONSTRAINT decisions_active_shape_check CHECK (
    status <> 'active' OR (
      selected_option_id IS NOT NULL AND rationale IS NOT NULL AND
      approved_by_type IS NOT NULL AND approved_by_id IS NOT NULL AND effective_at IS NOT NULL AND
      aop.is_principal_ref(approved_by_type, approved_by_id)
    )
  ),
  CONSTRAINT decisions_approver_pair_check CHECK (
    (approved_by_type IS NULL AND approved_by_id IS NULL) OR
    (approved_by_type IS NOT NULL AND approved_by_id IS NOT NULL AND aop.is_principal_ref(approved_by_type, approved_by_id))
  ),
  CONSTRAINT decisions_not_self_supersede CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id),
  CONSTRAINT decisions_supersedes_same_org_fk FOREIGN KEY (organization_id, supersedes_decision_id)
    REFERENCES aop.decisions(organization_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE aop.decision_impacts (
  organization_id text NOT NULL,
  decision_id text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  impact_type text NOT NULL CHECK (impact_type IN ('affected', 'requires_rebase', 'blocks', 'unblocks', 'supersedes')),
  detail text CHECK (detail IS NULL OR length(detail) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, decision_id, resource_type, resource_id, impact_type),
  CONSTRAINT decision_impacts_decision_fk FOREIGN KEY (organization_id, decision_id)
    REFERENCES aop.decisions(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT decision_impacts_resource_ref_check CHECK (aop.is_resource_ref(resource_type, resource_id))
);

CREATE TABLE aop.reviews (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'rev')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  reviewer_type text NOT NULL CHECK (reviewer_type IN ('human', 'agent', 'system')),
  reviewer_id text NOT NULL,
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'array' AND jsonb_array_length(criteria) > 0),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  result text NOT NULL CHECK (result IN ('pending', 'pass', 'rework', 'fail')),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array'),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  CONSTRAINT reviews_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT reviews_subject_ref_check CHECK (aop.is_resource_ref(subject_type, subject_id)),
  CONSTRAINT reviews_reviewer_check CHECK (aop.is_principal_ref(reviewer_type, reviewer_id)),
  CONSTRAINT reviews_completion_check CHECK (
    (result = 'pending' AND completed_at IS NULL) OR
    (result <> 'pending' AND completed_at IS NOT NULL)
  )
);

CREATE TABLE aop.permissions (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'per')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('human', 'agent', 'system')),
  principal_id text NOT NULL,
  capability varchar(128) NOT NULL CHECK (capability ~ '^[a-z][a-z0-9_.:-]+$'),
  effect text NOT NULL CHECK (effect IN ('allow', 'require_approval', 'deny')),
  resource_type text,
  resource_id text,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  granted_by_type text NOT NULL CHECK (granted_by_type IN ('human', 'agent', 'system')),
  granted_by_id text NOT NULL,
  expires_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  CONSTRAINT permissions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT permissions_principal_check CHECK (aop.is_principal_ref(principal_type, principal_id)),
  CONSTRAINT permissions_grantor_check CHECK (aop.is_principal_ref(granted_by_type, granted_by_id)),
  CONSTRAINT permissions_resource_pair_check CHECK (
    (resource_type IS NULL AND resource_id IS NULL) OR
    (resource_type IS NOT NULL AND resource_id IS NOT NULL AND aop.is_resource_ref(resource_type, resource_id))
  )
);

CREATE TABLE aop.approval_requests (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'apr')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  command_id text NOT NULL CHECK (aop.is_prefixed_ulid(command_id, 'cmd')),
  command_type varchar(160) NOT NULL CHECK (command_type ~ '^[a-z][a-z0-9_.:-]+$'),
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('human', 'agent', 'system')),
  requested_by_id text NOT NULL,
  target_type text,
  target_id text,
  policy_rule varchar(128) NOT NULL CHECK (policy_rule ~ '^[a-z][a-z0-9_.:-]+$'),
  required_authority text NOT NULL CHECK (required_authority IN ('human', 'manager', 'role_capability')),
  risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high', 'critical')),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  impact_summary text NOT NULL CHECK (length(btrim(impact_summary)) > 0 AND length(impact_summary) <= 2000),
  estimated_cost_credits numeric CHECK (estimated_cost_credits IS NULL OR estimated_cost_credits >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested', 'expired', 'cancelled')),
  decided_by_type text CHECK (decided_by_type IS NULL OR decided_by_type IN ('human', 'agent', 'system')),
  decided_by_id text,
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 2000),
  expires_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  CONSTRAINT approval_requests_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT approval_requests_command_fk FOREIGN KEY (organization_id, command_id)
    REFERENCES aop.command_deduplication(organization_id, command_id)
    ON DELETE RESTRICT,
  CONSTRAINT approval_requests_requester_check CHECK (aop.is_principal_ref(requested_by_type, requested_by_id)),
  CONSTRAINT approval_requests_target_pair_check CHECK (
    (target_type IS NULL AND target_id IS NULL) OR
    (target_type IS NOT NULL AND target_id IS NOT NULL AND aop.is_resource_ref(target_type, target_id))
  ),
  CONSTRAINT approval_requests_decision_shape_check CHECK (
    (
      status IN ('approved', 'rejected', 'changes_requested') AND
      decided_by_type IS NOT NULL AND decided_by_id IS NOT NULL AND decided_at IS NOT NULL AND
      aop.is_principal_ref(decided_by_type, decided_by_id)
    ) OR
    (
      status NOT IN ('approved', 'rejected', 'changes_requested') AND
      decided_by_type IS NULL AND decided_by_id IS NULL AND decided_at IS NULL
    )
  ),
  CONSTRAINT approval_requests_human_authority_check CHECK (
    required_authority <> 'human' OR decided_by_type IS NULL OR decided_by_type = 'human'
  )
);

ALTER TABLE aop.task_runs
  ADD CONSTRAINT task_runs_manifest_identity_unique
  UNIQUE (organization_id, id, task_id, agent_id);

CREATE TABLE aop.context_manifests (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'ctx')),
  organization_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  agent_id text NOT NULL,
  task_revision bigint NOT NULL CHECK (task_revision >= 0),
  fragments jsonb NOT NULL CHECK (jsonb_typeof(fragments) = 'array' AND jsonb_array_length(fragments) > 0),
  total_token_estimate bigint NOT NULL CHECK (total_token_estimate >= 0),
  compiled_at timestamptz NOT NULL,
  CONSTRAINT context_manifests_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT context_manifests_run_identity_fk FOREIGN KEY (organization_id, run_id, task_id, agent_id)
    REFERENCES aop.task_runs(organization_id, id, task_id, agent_id)
    ON DELETE CASCADE
);

CREATE TABLE aop.events (
  id text PRIMARY KEY CHECK (aop.is_prefixed_ulid(id, 'evt')),
  organization_id text NOT NULL REFERENCES aop.organizations(id) ON DELETE CASCADE,
  organization_sequence bigint NOT NULL CHECK (organization_sequence > 0),
  type varchar(160) NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.:-]+$'),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_revision bigint NOT NULL CHECK (aggregate_revision >= 0),
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_id text NOT NULL,
  causation_id text,
  correlation_id varchar(200) NOT NULL CHECK (length(correlation_id) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  CONSTRAINT events_org_sequence_unique UNIQUE (organization_id, organization_sequence),
  CONSTRAINT events_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT events_aggregate_ref_check CHECK (aop.is_resource_ref(aggregate_type, aggregate_id)),
  CONSTRAINT events_actor_check CHECK (aop.is_principal_ref(actor_type, actor_id)),
  CONSTRAINT events_causation_fk FOREIGN KEY (organization_id, causation_id)
    REFERENCES aop.command_deduplication(organization_id, command_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE aop.outbox_events (
  event_id text PRIMARY KEY,
  organization_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by varchar(160),
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_event_fk FOREIGN KEY (organization_id, event_id)
    REFERENCES aop.events(organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX command_deduplication_status_idx
  ON aop.command_deduplication (organization_id, status, updated_at);

CREATE INDEX artifacts_type_updated_idx
  ON aop.artifacts (organization_id, type, updated_at DESC);

CREATE INDEX artifact_versions_status_idx
  ON aop.artifact_versions (organization_id, artifact_id, status, version DESC);

CREATE INDEX artifact_lineage_parent_idx
  ON aop.artifact_lineage (organization_id, parent_version_id);

CREATE INDEX task_artifact_inputs_version_idx
  ON aop.task_artifact_inputs (organization_id, artifact_version_id);

CREATE INDEX decisions_status_scope_idx
  ON aop.decisions (organization_id, status, scope, updated_at DESC);

CREATE INDEX decision_impacts_resource_idx
  ON aop.decision_impacts (organization_id, resource_type, resource_id);

CREATE INDEX reviews_subject_idx
  ON aop.reviews (organization_id, subject_type, subject_id, result);

CREATE INDEX permissions_principal_capability_idx
  ON aop.permissions (organization_id, principal_type, principal_id, capability, effect);

CREATE INDEX approval_requests_pending_idx
  ON aop.approval_requests (organization_id, risk, created_at)
  WHERE status = 'pending';

CREATE INDEX context_manifests_run_idx
  ON aop.context_manifests (organization_id, run_id, compiled_at DESC);

CREATE INDEX events_correlation_idx
  ON aop.events (organization_id, correlation_id, organization_sequence);

CREATE INDEX events_aggregate_idx
  ON aop.events (organization_id, aggregate_type, aggregate_id, organization_sequence DESC);

CREATE INDEX outbox_events_claim_idx
  ON aop.outbox_events (status, available_at, created_at)
  WHERE status IN ('pending', 'failed');

INSERT INTO aop.schema_migrations(version)
VALUES ('0003_organizational_truth')
ON CONFLICT (version) DO NOTHING;

COMMIT;

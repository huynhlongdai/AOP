BEGIN;

ALTER TABLE aop.context_manifests
  ADD COLUMN schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  ADD COLUMN protocol_version varchar(32) NOT NULL DEFAULT '0.1.0' CHECK (protocol_version = '0.1.0');

-- Slice 3 v0.1 freezes one exact Context Manifest per TaskRun. If authoritative
-- context changes after a Run is prepared, recovery/retry must create a new Run
-- rather than silently changing the prompt within the existing execution.
CREATE UNIQUE INDEX context_manifests_one_per_run_idx
  ON aop.context_manifests (organization_id, run_id);

CREATE OR REPLACE FUNCTION aop.validate_context_manifest_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_task_revision bigint;
  current_run_status text;
  fragment jsonb;
  calculated_tokens bigint := 0;
  required_kind text;
BEGIN
  SELECT task.revision, run.status
    INTO current_task_revision, current_run_status
    FROM aop.task_runs run
    JOIN aop.tasks task
      ON task.organization_id = run.organization_id
     AND task.id = run.task_id
   WHERE run.organization_id = NEW.organization_id
     AND run.id = NEW.run_id
     AND run.task_id = NEW.task_id
     AND run.agent_id = NEW.agent_id;

  IF current_task_revision IS NULL THEN
    RAISE EXCEPTION 'Context Manifest run/task/agent identity does not exist'
      USING ERRCODE = '23503', CONSTRAINT = 'context_manifests_run_identity_fk';
  END IF;

  IF current_run_status NOT IN ('created', 'preparing') THEN
    RAISE EXCEPTION 'Context Manifest may only be compiled before execution; run % is %', NEW.run_id, current_run_status
      USING ERRCODE = '23514', CONSTRAINT = 'context_manifest_pre_execution_only';
  END IF;

  IF NEW.task_revision <> current_task_revision THEN
    RAISE EXCEPTION 'Context Manifest task revision % does not match current revision %', NEW.task_revision, current_task_revision
      USING ERRCODE = '23514', CONSTRAINT = 'context_manifest_current_task_revision';
  END IF;

  FOR fragment IN SELECT value FROM jsonb_array_elements(NEW.fragments)
  LOOP
    IF jsonb_typeof(fragment) <> 'object'
       OR jsonb_typeof(fragment->'key') <> 'string'
       OR jsonb_typeof(fragment->'kind') <> 'string'
       OR jsonb_typeof(fragment->'trust') <> 'string'
       OR jsonb_typeof(fragment->'mandatory') <> 'boolean'
       OR jsonb_typeof(fragment->'authorityWeight') <> 'number'
       OR jsonb_typeof(fragment->'relevanceWeight') <> 'number'
       OR jsonb_typeof(fragment->'tokenEstimate') <> 'number'
       OR jsonb_typeof(fragment->'content') <> 'string'
       OR jsonb_typeof(fragment->'digest') <> 'string'
       OR (fragment->>'digest') !~ '^sha256:[a-f0-9]{64}$'
       OR length(fragment->>'content') = 0
       OR (fragment->>'tokenEstimate')::bigint <= 0
    THEN
      RAISE EXCEPTION 'Context Manifest contains malformed fragment'
        USING ERRCODE = '23514', CONSTRAINT = 'context_manifest_fragment_shape';
    END IF;

    IF fragment->>'trust' = 'untrusted' AND (fragment->>'authorityWeight')::numeric <> 0 THEN
      RAISE EXCEPTION 'Untrusted Context fragment cannot carry authority weight'
        USING ERRCODE = '23514', CONSTRAINT = 'context_manifest_untrusted_no_authority';
    END IF;

    calculated_tokens := calculated_tokens + (fragment->>'tokenEstimate')::bigint;
  END LOOP;

  IF calculated_tokens <> NEW.total_token_estimate THEN
    RAISE EXCEPTION 'Context Manifest token total % does not match fragment total %', NEW.total_token_estimate, calculated_tokens
      USING ERRCODE = '23514', CONSTRAINT = 'context_manifest_token_total';
  END IF;

  FOREACH required_kind IN ARRAY ARRAY['policy','identity','role','authority','goal','task','output_contract']
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(NEW.fragments) AS f
       WHERE f->>'kind' = required_kind
         AND (f->>'mandatory')::boolean = true
    ) THEN
      RAISE EXCEPTION 'Context Manifest missing mandatory % fragment', required_kind
        USING ERRCODE = '23514', CONSTRAINT = 'context_manifest_required_fragments';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER context_manifests_validate_insert
BEFORE INSERT ON aop.context_manifests
FOR EACH ROW
EXECUTE FUNCTION aop.validate_context_manifest_insert();

INSERT INTO aop.schema_migrations(version)
VALUES ('0012_context_manifest_integrity')
ON CONFLICT (version) DO NOTHING;

COMMIT;

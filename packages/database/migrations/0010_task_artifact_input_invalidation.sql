BEGIN;

-- Staleness is derived organizational truth, not duplicated mutable state.
-- A Task input is stale when the version it consumes has been superseded and
-- the Artifact now points at a different approved version.
CREATE VIEW aop.task_artifact_input_status AS
SELECT
  tai.organization_id,
  tai.task_id,
  input_version.artifact_id,
  tai.artifact_version_id,
  tai.required,
  tai.created_at,
  CASE
    WHEN input_version.status = 'superseded'
      AND artifact.current_approved_version_id IS NOT NULL
      AND artifact.current_approved_version_id <> tai.artifact_version_id
    THEN artifact.current_approved_version_id
    ELSE NULL
  END AS invalidated_by_version_id,
  CASE
    WHEN input_version.status = 'superseded'
      AND artifact.current_approved_version_id IS NOT NULL
      AND artifact.current_approved_version_id <> tai.artifact_version_id
    THEN replacement.approved_at
    ELSE NULL
  END AS invalidated_at,
  (
    input_version.status = 'superseded'
    AND artifact.current_approved_version_id IS NOT NULL
    AND artifact.current_approved_version_id <> tai.artifact_version_id
  ) AS stale
FROM aop.task_artifact_inputs tai
JOIN aop.artifact_versions input_version
  ON input_version.organization_id = tai.organization_id
 AND input_version.id = tai.artifact_version_id
JOIN aop.artifacts artifact
  ON artifact.organization_id = input_version.organization_id
 AND artifact.id = input_version.artifact_id
LEFT JOIN aop.artifact_versions replacement
  ON replacement.organization_id = artifact.organization_id
 AND replacement.artifact_id = artifact.id
 AND replacement.id = artifact.current_approved_version_id;

-- Defense in depth for direct task.claim calls. The Scheduler filters the same
-- derived view, but a command that bypasses Scheduler must still be unable to
-- lease work whose required inputs are stale.
CREATE OR REPLACE FUNCTION aop.prevent_stale_required_task_claim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state = 'leased' AND OLD.state IS DISTINCT FROM 'leased' AND EXISTS (
    SELECT 1
      FROM aop.task_artifact_input_status input_status
     WHERE input_status.organization_id = NEW.organization_id
       AND input_status.task_id = NEW.id
       AND input_status.required = true
       AND input_status.stale = true
  ) THEN
    RAISE EXCEPTION 'task % has stale required Artifact inputs', NEW.id
      USING ERRCODE = '23514',
            CONSTRAINT = 'tasks_no_stale_required_inputs_on_lease';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_prevent_stale_required_input_claim
BEFORE UPDATE OF state ON aop.tasks
FOR EACH ROW
EXECUTE FUNCTION aop.prevent_stale_required_task_claim();

INSERT INTO aop.schema_migrations(version)
VALUES ('0010_task_artifact_input_invalidation')
ON CONFLICT (version) DO NOTHING;

COMMIT;

BEGIN;

ALTER TABLE aop.task_artifact_inputs
  ADD COLUMN invalidated_by_version_id text,
  ADD COLUMN invalidated_at timestamptz;

ALTER TABLE aop.task_artifact_inputs
  ADD CONSTRAINT task_artifact_inputs_invalidation_shape_check CHECK (
    (invalidated_by_version_id IS NULL AND invalidated_at IS NULL) OR
    (invalidated_by_version_id IS NOT NULL AND invalidated_at IS NOT NULL)
  ),
  ADD CONSTRAINT task_artifact_inputs_not_self_invalidated CHECK (
    invalidated_by_version_id IS NULL OR invalidated_by_version_id <> artifact_version_id
  ),
  ADD CONSTRAINT task_artifact_inputs_invalidator_fk
    FOREIGN KEY (organization_id, invalidated_by_version_id)
    REFERENCES aop.artifact_versions(organization_id, id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX task_artifact_inputs_stale_required_idx
  ON aop.task_artifact_inputs (organization_id, task_id)
  WHERE required = true AND invalidated_by_version_id IS NOT NULL;

INSERT INTO aop.schema_migrations(version)
VALUES ('0010_task_artifact_input_invalidation')
ON CONFLICT (version) DO NOTHING;

COMMIT;

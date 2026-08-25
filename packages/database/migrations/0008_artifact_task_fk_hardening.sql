BEGIN;

ALTER TABLE aop.artifact_versions
  DROP CONSTRAINT artifact_versions_task_fk;

ALTER TABLE aop.artifact_versions
  ADD CONSTRAINT artifact_versions_task_fk
  FOREIGN KEY (organization_id, produced_by_task_id)
  REFERENCES aop.tasks(organization_id, id)
  ON DELETE SET NULL (produced_by_task_id);

INSERT INTO aop.schema_migrations(version)
VALUES ('0008_artifact_task_fk_hardening')
ON CONFLICT (version) DO NOTHING;

COMMIT;

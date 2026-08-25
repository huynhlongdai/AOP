BEGIN;

ALTER TABLE aop.artifact_lineage
  DROP CONSTRAINT artifact_lineage_parent_fk;

ALTER TABLE aop.artifact_lineage
  ADD CONSTRAINT artifact_lineage_parent_fk
  FOREIGN KEY (organization_id, parent_version_id)
  REFERENCES aop.artifact_versions(organization_id, id)
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

INSERT INTO aop.schema_migrations(version)
VALUES ('0009_artifact_lineage_delete_hardening')
ON CONFLICT (version) DO NOTHING;

COMMIT;

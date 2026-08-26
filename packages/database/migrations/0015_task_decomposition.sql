BEGIN;

CREATE TABLE aop.task_decompositions (
  organization_id text NOT NULL,
  parent_task_id text NOT NULL,
  child_task_id text NOT NULL,
  created_by_type text NOT NULL CHECK (created_by_type IN ('human', 'agent', 'system')),
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, parent_task_id, child_task_id),
  CONSTRAINT task_decompositions_child_unique UNIQUE (organization_id, child_task_id),
  CONSTRAINT task_decompositions_not_self CHECK (parent_task_id <> child_task_id),
  CONSTRAINT task_decompositions_parent_fk FOREIGN KEY (organization_id, parent_task_id)
    REFERENCES aop.tasks(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT task_decompositions_child_fk FOREIGN KEY (organization_id, child_task_id)
    REFERENCES aop.tasks(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT task_decompositions_creator_check CHECK (aop.is_principal_ref(created_by_type, created_by_id))
);

CREATE INDEX task_decompositions_parent_idx
  ON aop.task_decompositions (organization_id, parent_task_id, created_at, child_task_id);

INSERT INTO aop.schema_migrations(version)
VALUES ('0015_task_decomposition')
ON CONFLICT (version) DO NOTHING;

COMMIT;

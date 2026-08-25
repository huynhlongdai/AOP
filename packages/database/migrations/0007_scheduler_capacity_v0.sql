BEGIN;

CREATE UNIQUE INDEX leases_one_active_per_agent_idx
  ON aop.leases (organization_id, agent_id)
  WHERE status = 'active';

INSERT INTO aop.schema_migrations(version)
VALUES ('0007_scheduler_capacity_v0')
ON CONFLICT (version) DO NOTHING;

COMMIT;

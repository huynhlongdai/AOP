BEGIN;

CREATE TABLE aop.runtime_run_reports (
  organization_id text NOT NULL,
  run_id text NOT NULL,
  task_id text NOT NULL,
  agent_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  context_manifest_id text NOT NULL,
  runtime_id varchar(240) NOT NULL CHECK (length(btrim(runtime_id)) > 0),
  adapter varchar(128) NOT NULL CHECK (adapter ~ '^[a-z][a-z0-9_.:-]+$'),
  provider varchar(80),
  model varchar(160),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
  usage jsonb NOT NULL CHECK (jsonb_typeof(usage) = 'object'),
  trace_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(trace_refs) = 'array'),
  command_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(command_outcomes) = 'array'),
  failure_reason text CHECK (failure_reason IS NULL OR (length(btrim(failure_reason)) > 0 AND length(failure_reason) <= 2000)),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  protocol_version varchar(32) NOT NULL DEFAULT '0.1.0' CHECK (protocol_version = '0.1.0'),
  PRIMARY KEY (organization_id, run_id),
  CONSTRAINT runtime_run_reports_time_check CHECK (
    finished_at >= started_at AND created_at >= finished_at
  ),
  CONSTRAINT runtime_run_reports_failure_shape_check CHECK (
    (status = 'failed' AND failure_reason IS NOT NULL) OR
    (status = 'succeeded' AND failure_reason IS NULL) OR
    status = 'cancelled'
  ),
  CONSTRAINT runtime_run_reports_run_identity_fk FOREIGN KEY (
    organization_id, run_id, task_id, agent_id, attempt
  ) REFERENCES aop.task_runs(organization_id, id, task_id, agent_id, attempt)
    ON DELETE CASCADE,
  CONSTRAINT runtime_run_reports_context_manifest_fk FOREIGN KEY (
    organization_id, context_manifest_id
  ) REFERENCES aop.context_manifests(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX runtime_run_reports_task_idx
  ON aop.runtime_run_reports (organization_id, task_id, attempt DESC);

CREATE INDEX runtime_run_reports_agent_idx
  ON aop.runtime_run_reports (organization_id, agent_id, finished_at DESC);

CREATE OR REPLACE FUNCTION aop.reject_runtime_run_report_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Runtime Run Reports are immutable once inserted'
    USING ERRCODE = '55000', CONSTRAINT = 'runtime_run_reports_immutable';
END;
$$;

CREATE TRIGGER runtime_run_reports_reject_update
BEFORE UPDATE ON aop.runtime_run_reports
FOR EACH ROW
EXECUTE FUNCTION aop.reject_runtime_run_report_update();

INSERT INTO aop.schema_migrations(version)
VALUES ('0013_runtime_run_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;

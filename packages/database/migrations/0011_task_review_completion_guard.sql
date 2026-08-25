BEGIN;

-- One live QA loop per Task. Historical resolved reviews remain immutable audit evidence.
CREATE UNIQUE INDEX reviews_one_pending_task_review_idx
  ON aop.reviews (organization_id, subject_id)
  WHERE subject_type = 'task' AND result = 'pending';

-- Validation only: this trigger never changes authoritative state. It prevents a
-- direct SQL or buggy command path from declaring a Task completed without a
-- matching passing Review against the current required Artifact truth.
CREATE OR REPLACE FUNCTION aop.validate_task_completion_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state <> 'completed' THEN
    RETURN NEW;
  END IF;

  IF NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'completed task % requires completed_at', NEW.id
      USING ERRCODE = '23514',
            CONSTRAINT = 'tasks_completed_requires_timestamp';
  END IF;

  IF NEW.reviewer_agent_id IS NULL THEN
    RAISE EXCEPTION 'completed task % requires reviewer_agent_id', NEW.id
      USING ERRCODE = '23514',
            CONSTRAINT = 'tasks_completed_requires_reviewer';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM aop.task_artifact_input_status input_status
     WHERE input_status.organization_id = NEW.organization_id
       AND input_status.task_id = NEW.id
       AND input_status.required = true
       AND input_status.stale = true
  ) THEN
    RAISE EXCEPTION 'task % cannot complete with stale required Artifact inputs', NEW.id
      USING ERRCODE = '23514',
            CONSTRAINT = 'tasks_no_stale_required_inputs_on_completion';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM aop.reviews review
     WHERE review.organization_id = NEW.organization_id
       AND review.subject_type = 'task'
       AND review.subject_id = NEW.id
       AND review.reviewer_type = 'agent'
       AND review.reviewer_id = NEW.reviewer_agent_id
       AND review.result = 'pass'
       AND review.completed_at = NEW.completed_at
  ) THEN
    RAISE EXCEPTION 'completed task % requires a matching passing Review', NEW.id
      USING ERRCODE = '23514',
            CONSTRAINT = 'tasks_completed_requires_passing_review';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_validate_completion_on_insert
BEFORE INSERT ON aop.tasks
FOR EACH ROW
WHEN (NEW.state = 'completed')
EXECUTE FUNCTION aop.validate_task_completion_evidence();

CREATE TRIGGER tasks_validate_completion_on_update
BEFORE UPDATE OF state, completed_at, reviewer_agent_id ON aop.tasks
FOR EACH ROW
WHEN (NEW.state = 'completed')
EXECUTE FUNCTION aop.validate_task_completion_evidence();

INSERT INTO aop.schema_migrations(version)
VALUES ('0011_task_review_completion_guard')
ON CONFLICT (version) DO NOTHING;

COMMIT;

BEGIN;

ALTER TABLE aop.decisions
  DROP CONSTRAINT decisions_active_shape_check;

ALTER TABLE aop.decisions
  ADD CONSTRAINT decisions_approval_history_shape_check CHECK (
    (
      status IN ('active', 'superseded') AND
      selected_option_id IS NOT NULL AND rationale IS NOT NULL AND
      approved_by_type IS NOT NULL AND approved_by_id IS NOT NULL AND effective_at IS NOT NULL AND
      aop.is_principal_ref(approved_by_type, approved_by_id)
    ) OR
    (
      status NOT IN ('active', 'superseded') AND
      approved_by_type IS NULL AND approved_by_id IS NULL AND effective_at IS NULL
    )
  );

ALTER TABLE aop.reviews
  DROP CONSTRAINT reviews_completion_check;

ALTER TABLE aop.reviews
  ADD CONSTRAINT reviews_completion_check CHECK (
    (result = 'pending' AND completed_at IS NULL) OR
    (result <> 'pending' AND completed_at IS NOT NULL)
  ),
  ADD CONSTRAINT reviews_evidence_findings_check CHECK (
    (result = 'pending') OR
    (result = 'pass' AND jsonb_array_length(evidence) > 0) OR
    (result IN ('rework', 'fail') AND jsonb_array_length(findings) > 0)
  );

INSERT INTO aop.schema_migrations(version)
VALUES ('0004_integrity_hardening')
ON CONFLICT (version) DO NOTHING;

COMMIT;

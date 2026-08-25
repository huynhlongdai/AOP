BEGIN;

ALTER TABLE aop.outbox_events
  ADD CONSTRAINT outbox_events_delivery_shape_check CHECK (
    (
      status = 'processing' AND
      locked_at IS NOT NULL AND locked_by IS NOT NULL AND
      published_at IS NULL
    ) OR
    (
      status IN ('pending', 'failed') AND
      locked_at IS NULL AND locked_by IS NULL AND
      published_at IS NULL
    ) OR
    (
      status = 'published' AND
      locked_at IS NULL AND locked_by IS NULL AND
      published_at IS NOT NULL
    )
  );

CREATE INDEX outbox_events_stale_processing_idx
  ON aop.outbox_events (locked_at, created_at)
  WHERE status = 'processing';

INSERT INTO aop.schema_migrations(version)
VALUES ('0006_outbox_delivery_hardening')
ON CONFLICT (version) DO NOTHING;

COMMIT;

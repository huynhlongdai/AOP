BEGIN;

ALTER TABLE aop.events
  ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  ADD COLUMN protocol_version varchar(32) NOT NULL DEFAULT '0.1.0' CHECK (protocol_version ~ '^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$');

ALTER TABLE aop.events
  ALTER COLUMN schema_version DROP DEFAULT,
  ALTER COLUMN protocol_version DROP DEFAULT;

INSERT INTO aop.schema_migrations(version)
VALUES ('0005_event_versioning')
ON CONFLICT (version) DO NOTHING;

COMMIT;

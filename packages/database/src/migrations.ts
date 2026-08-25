export const DATABASE_MIGRATIONS = [
  "0001_foundation",
  "0002_task_engine",
  "0003_organizational_truth",
  "0004_integrity_hardening",
  "0005_event_versioning",
] as const;

export type DatabaseMigration = (typeof DATABASE_MIGRATIONS)[number];

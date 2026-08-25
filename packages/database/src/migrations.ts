export const DATABASE_MIGRATIONS = [
  "0001_foundation",
  "0002_task_engine",
  "0003_organizational_truth",
  "0004_integrity_hardening",
  "0005_event_versioning",
  "0006_outbox_delivery_hardening",
  "0007_scheduler_capacity_v0",
] as const;

export type DatabaseMigration = (typeof DATABASE_MIGRATIONS)[number];

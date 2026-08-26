export const DATABASE_MIGRATIONS = [
  "0001_foundation",
  "0002_task_engine",
  "0003_organizational_truth",
  "0004_integrity_hardening",
  "0005_event_versioning",
  "0006_outbox_delivery_hardening",
  "0007_scheduler_capacity_v0",
  "0008_artifact_task_fk_hardening",
  "0009_artifact_lineage_delete_hardening",
  "0010_task_artifact_input_invalidation",
  "0011_task_review_completion_guard",
  "0012_context_manifest_integrity",
  "0013_runtime_run_reports",
  "0014_context_at_execution_boundary",
  "0015_task_decomposition",
] as const;

export type DatabaseMigration = (typeof DATABASE_MIGRATIONS)[number];

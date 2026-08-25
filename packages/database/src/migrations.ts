export const DATABASE_MIGRATIONS = [
  "0001_foundation",
  "0002_task_engine",
  "0003_organizational_truth",
] as const;

export type DatabaseMigration = (typeof DATABASE_MIGRATIONS)[number];

export const DATABASE_MIGRATIONS = ["0001_foundation"] as const;

export type DatabaseMigration = (typeof DATABASE_MIGRATIONS)[number];

import { Pool } from "pg";

import { PostgresQueryStore } from "@aop/database";

import { buildApiServer } from "./server.js";

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const app = buildApiServer({
    queryStore: new PostgresQueryStore(pool),
    logger: true,
  });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await pool.end();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  try {
    await app.listen({
      host: process.env.HOST ?? "0.0.0.0",
      port: parsePort(process.env.PORT),
    });
  } catch (error) {
    await shutdown();
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import type { Pool } from "pg";

import {
  AOP_PROTOCOL_VERSION,
  CommandResultSchema,
  type CommandResult,
  type LeaseId,
  type OrganizationId,
} from "@aop/protocol";

import { deterministicPrefixedUlid } from "./ids.js";

export interface ExpiredLeaseCandidate {
  readonly organizationId: OrganizationId;
  readonly leaseId: LeaseId;
  readonly leaseRevision: number;
  readonly expiresAt: string;
}

export interface ExpiredLeaseStore {
  listExpired(limit: number, now: string): Promise<readonly ExpiredLeaseCandidate[]>;
}

export interface LeaseReaperCommandExecutor {
  execute(input: unknown): Promise<CommandResult>;
}

export interface LeaseReaperOptions {
  readonly store: ExpiredLeaseStore;
  readonly executor: LeaseReaperCommandExecutor;
  readonly now: () => string;
  readonly candidateLimit?: number;
}

export interface LeaseReaperRunResult {
  readonly attempted: number;
  readonly recovered?: ExpiredLeaseCandidate;
  readonly commandResult?: CommandResult;
}

export class PostgresExpiredLeaseStore implements ExpiredLeaseStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listExpired(limit: number, now: string): Promise<readonly ExpiredLeaseCandidate[]> {
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const result = await this.#pool.query<{
      organization_id: string;
      id: string;
      revision: string | number;
      expires_at: Date | string;
    }>(
      `SELECT organization_id, id, revision, expires_at
         FROM aop.leases
        WHERE status = 'active' AND expires_at <= $1
        ORDER BY expires_at ASC, organization_id ASC, id ASC
        LIMIT $2`,
      [now, safeLimit],
    );

    return result.rows.map((row) => ({
      organizationId: row.organization_id as OrganizationId,
      leaseId: row.id as LeaseId,
      leaseRevision: Number(row.revision),
      expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : new Date(row.expires_at).toISOString(),
    }));
  }
}

function expiryCommand(candidate: ExpiredLeaseCandidate, now: string) {
  const seed = `${candidate.organizationId}:${candidate.leaseId}:${candidate.leaseRevision}`;
  return {
    schemaVersion: 1 as const,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: deterministicPrefixedUlid("cmd", candidate.expiresAt, `${seed}:expire`),
    type: "lease.expire",
    organizationId: candidate.organizationId,
    actor: { type: "system" as const, id: "runtime-manager" as const },
    target: { type: "lease" as const, id: candidate.leaseId },
    expectedRevision: candidate.leaseRevision,
    idempotencyKey: `runtime-manager.expire:${candidate.leaseId}:${candidate.leaseRevision}`,
    payload: {},
    issuedAt: now,
  };
}

export class DeterministicLeaseReaper {
  readonly #options: Required<Pick<LeaseReaperOptions, "candidateLimit">> & Omit<LeaseReaperOptions, "candidateLimit">;

  constructor(options: LeaseReaperOptions) {
    this.#options = {
      ...options,
      candidateLimit: options.candidateLimit ?? 64,
    };
    if (this.#options.candidateLimit < 1 || this.#options.candidateLimit > 500) {
      throw new RangeError("candidateLimit must be between 1 and 500");
    }
  }

  async runOnce(): Promise<LeaseReaperRunResult> {
    const now = this.#options.now();
    const candidates = await this.#options.store.listExpired(this.#options.candidateLimit, now);
    let attempted = 0;
    let lastResult: CommandResult | undefined;

    for (const candidate of candidates) {
      attempted += 1;
      const result = CommandResultSchema.parse(await this.#options.executor.execute(expiryCommand(candidate, now)));
      lastResult = result;
      if (result.ok) return { attempted, recovered: candidate, commandResult: result };

      if (result.error.code === "forbidden" || result.error.code === "approval_required") {
        return { attempted, commandResult: result };
      }
    }

    return {
      attempted,
      ...(lastResult === undefined ? {} : { commandResult: lastResult }),
    };
  }
}

export interface LeaseReaperLoopOptions {
  readonly reaper: DeterministicLeaseReaper;
  readonly signal: AbortSignal;
  readonly idleIntervalMs?: number;
  readonly onResult?: (result: LeaseReaperRunResult) => void;
  readonly onError?: (error: unknown) => void;
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runLeaseReaperLoop(options: LeaseReaperLoopOptions): Promise<void> {
  const idleIntervalMs = options.idleIntervalMs ?? 1_000;
  if (idleIntervalMs < 50 || idleIntervalMs > 60_000) {
    throw new RangeError("idleIntervalMs must be between 50 and 60000");
  }

  while (!options.signal.aborted) {
    try {
      const result = await options.reaper.runOnce();
      options.onResult?.(result);
      if (result.recovered !== undefined) continue;
    } catch (error) {
      options.onError?.(error);
    }
    await delay(idleIntervalMs, options.signal);
  }
}

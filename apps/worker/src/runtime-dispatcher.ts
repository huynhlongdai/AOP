import type { Pool } from "pg";

import {
  PostgresAuthorizationResolver,
  PostgresRuntimeCommandStore,
} from "@aop/database";
import { evaluatePolicy } from "@aop/policy-engine";
import {
  AOP_PROTOCOL_VERSION,
  AgentSchema,
  CommandEnvelopeSchema,
  TaskBudgetSchema,
  type Agent,
  type CommandEnvelope,
  type ContextManifestId,
  type OrganizationId,
  type TaskBudget,
  type TaskId,
  type TaskRunId,
} from "@aop/protocol";
import {
  KernelLifecycleCommandError,
  type RuntimeExecutionPolicy,
  type RuntimeManager,
  type RuntimeRunReport,
} from "@aop/runtime";
import { deterministicPrefixedUlid } from "@aop/scheduler";

const POLICY_COMMAND_ID = "cmd_00000000000000000000000000" as const;
const DEFAULT_REQUIRED_COMPLETION_COMMAND = "task.submit_review";

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function json(value: unknown): unknown {
  if (typeof value === "string") return JSON.parse(value) as unknown;
  return value;
}

function boundedError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim().slice(0, 2_000);
  return "Runtime dispatch failed without a structured error";
}

function assertLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new TypeError("Runtime dispatch candidate limit must be an integer between 1 and 100");
  }
}

export interface RuntimeDispatchCandidate {
  readonly organizationId: OrganizationId;
  readonly taskId: TaskId;
  readonly taskRevision: number;
  readonly runId: TaskRunId;
  readonly agent: Agent;
  readonly leaseAcquiredAt: string;
  readonly heartbeatIntervalSeconds: number;
  readonly taskBudget: TaskBudget;
}

export interface RuntimeCandidateStore {
  listCandidates(limit: number): Promise<readonly RuntimeDispatchCandidate[]>;
}

export class PostgresRuntimeCandidateStore implements RuntimeCandidateStore {
  readonly #pool: Pool;
  readonly #runtimeType: string;
  readonly #now: () => string;

  constructor(pool: Pool, runtimeType: string, now: () => string = () => new Date().toISOString()) {
    this.#pool = pool;
    this.#runtimeType = runtimeType;
    this.#now = now;
  }

  async listCandidates(limit: number): Promise<readonly RuntimeDispatchCandidate[]> {
    assertLimit(limit);
    const now = this.#now();
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT
         r.organization_id,
         r.id AS run_id,
         r.task_id,
         t.revision AS task_revision,
         t.budget AS task_budget,
         l.acquired_at AS lease_acquired_at,
         l.heartbeat_interval_seconds,
         a.id AS agent_id,
         a.name AS agent_name,
         a.version AS agent_version,
         a.description AS agent_description,
         a.capabilities AS agent_capabilities,
         a.runtime AS agent_runtime,
         a.revision AS agent_revision,
         a.created_at AS agent_created_at,
         a.updated_at AS agent_updated_at
       FROM aop.task_runs r
       JOIN aop.tasks t
         ON t.organization_id = r.organization_id
        AND t.id = r.task_id
       JOIN aop.leases l
         ON l.organization_id = r.organization_id
        AND l.run_id = r.id
        AND l.task_id = r.task_id
        AND l.agent_id = r.agent_id
        AND l.attempt = r.attempt
       JOIN aop.organizations o
         ON o.id = r.organization_id
       JOIN aop.organization_memberships m
         ON m.organization_id = r.organization_id
        AND m.agent_id = r.agent_id
       JOIN aop.agents a
         ON a.id = r.agent_id
       LEFT JOIN aop.context_manifests cm
         ON cm.organization_id = r.organization_id
        AND cm.run_id = r.id
      WHERE r.status = 'created'
        AND t.state = 'leased'
        AND l.status = 'active'
        AND l.expires_at > $2::timestamptz
        AND o.status = 'active'
        AND m.status = 'active'
        AND r.runtime_type = $1
        AND a.runtime->>'adapter' = $1
        AND cm.id IS NULL
        AND EXISTS (
          SELECT 1
            FROM aop.role_assignments ra
           WHERE ra.organization_id = r.organization_id
             AND ra.agent_id = r.agent_id
             AND ra.active_from <= $2::timestamptz
             AND (ra.active_until IS NULL OR ra.active_until > $2::timestamptz)
        )
      ORDER BY
        CASE t.priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          ELSE 3
        END,
        l.acquired_at ASC,
        t.created_at ASC,
        r.attempt ASC,
        r.id ASC
      LIMIT $3`,
      [this.#runtimeType, now, limit],
    );

    return result.rows.map((row) => {
      const description =
        row.agent_description === null || row.agent_description === undefined
          ? undefined
          : String(row.agent_description);
      const agent = AgentSchema.parse({
        id: row.agent_id,
        name: row.agent_name,
        version: row.agent_version,
        ...(description === undefined ? {} : { description }),
        capabilities: json(row.agent_capabilities),
        runtime: json(row.agent_runtime),
        revision: Number(row.agent_revision),
        createdAt: timestamp(row.agent_created_at),
        updatedAt: timestamp(row.agent_updated_at),
      });
      return {
        organizationId: String(row.organization_id) as OrganizationId,
        taskId: String(row.task_id) as TaskId,
        taskRevision: Number(row.task_revision),
        runId: String(row.run_id) as TaskRunId,
        agent,
        leaseAcquiredAt: timestamp(row.lease_acquired_at),
        heartbeatIntervalSeconds: Number(row.heartbeat_interval_seconds),
        taskBudget: TaskBudgetSchema.parse(json(row.task_budget)),
      };
    });
  }
}

export interface RuntimeExecutionPolicyResolver {
  resolve(candidate: RuntimeDispatchCandidate): Promise<RuntimeExecutionPolicy>;
}

export interface PostgresRuntimeExecutionPolicyResolverOptions {
  readonly supportedCommandTypes: readonly string[];
  readonly maxOutputTokens?: number;
  readonly now?: () => string;
}

export class PostgresRuntimeExecutionPolicyResolver implements RuntimeExecutionPolicyResolver {
  readonly #store: PostgresRuntimeCommandStore;
  readonly #authorization: PostgresAuthorizationResolver;
  readonly #supportedCommandTypes: readonly string[];
  readonly #maxOutputTokens: number | undefined;
  readonly #now: () => string;

  constructor(pool: Pool, options: PostgresRuntimeExecutionPolicyResolverOptions) {
    this.#store = new PostgresRuntimeCommandStore(pool);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#authorization = new PostgresAuthorizationResolver(this.#now);
    this.#supportedCommandTypes = [...new Set(options.supportedCommandTypes)].sort();
    this.#maxOutputTokens = options.maxOutputTokens;
  }

  async resolve(candidate: RuntimeDispatchCandidate): Promise<RuntimeExecutionPolicy> {
    const now = this.#now();
    const allowedCommandTypes = await this.#store.transaction(async (transaction) => {
      const allowed: string[] = [];
      for (const type of this.#supportedCommandTypes) {
        const command = CommandEnvelopeSchema.parse({
          schemaVersion: 1,
          protocolVersion: AOP_PROTOCOL_VERSION,
          commandId: POLICY_COMMAND_ID,
          type,
          organizationId: candidate.organizationId,
          actor: { type: "agent", id: candidate.agent.id },
          target: { type: "task", id: candidate.taskId },
          expectedRevision: candidate.taskRevision,
          idempotencyKey: `runtime-policy:${candidate.runId}:${type}`,
          payload: {},
          issuedAt: now,
        }) as CommandEnvelope;
        const resolution = await this.#authorization.resolve(command, type, transaction);
        if (evaluatePolicy(resolution.policyInput).effect === "allow") allowed.push(type);
      }
      return allowed;
    });

    return {
      allowedCommandTypes,
      allowedToolCapabilities: [],
      ...(this.#maxOutputTokens === undefined ? {} : { maxOutputTokens: this.#maxOutputTokens }),
      ...(candidate.taskBudget.maxToolCalls === undefined
        ? {}
        : { maxToolCalls: candidate.taskBudget.maxToolCalls }),
    };
  }
}

export interface RuntimeManifestIdSource {
  next(candidate: RuntimeDispatchCandidate): ContextManifestId;
}

export class DeterministicRuntimeManifestIdSource implements RuntimeManifestIdSource {
  next(candidate: RuntimeDispatchCandidate): ContextManifestId {
    return deterministicPrefixedUlid(
      "ctx",
      candidate.leaseAcquiredAt,
      `runtime-context:${candidate.organizationId}:${candidate.runId}`,
    ) as ContextManifestId;
  }
}

export type RuntimeDispatchOutcome =
  | {
      readonly status: "executed";
      readonly organizationId: OrganizationId;
      readonly runId: TaskRunId;
      readonly report: RuntimeRunReport;
    }
  | {
      readonly status: "skipped" | "contended" | "failed";
      readonly organizationId: OrganizationId;
      readonly runId: TaskRunId;
      readonly reason: string;
    };

export interface RuntimeDispatcherOptions {
  readonly maxConcurrent: number;
  readonly maxContextTokens: number;
  readonly requiredCompletionCommand?: string;
}

export class RuntimeDispatcher {
  readonly #candidates: RuntimeCandidateStore;
  readonly #policies: RuntimeExecutionPolicyResolver;
  readonly #manager: Pick<RuntimeManager, "execute">;
  readonly #manifestIds: RuntimeManifestIdSource;
  readonly #maxConcurrent: number;
  readonly #maxContextTokens: number;
  readonly #requiredCompletionCommand: string;

  constructor(
    candidates: RuntimeCandidateStore,
    policies: RuntimeExecutionPolicyResolver,
    manager: Pick<RuntimeManager, "execute">,
    manifestIds: RuntimeManifestIdSource,
    options: RuntimeDispatcherOptions,
  ) {
    assertLimit(options.maxConcurrent);
    if (!Number.isInteger(options.maxContextTokens) || options.maxContextTokens < 1) {
      throw new TypeError("maxContextTokens must be a positive integer");
    }
    this.#candidates = candidates;
    this.#policies = policies;
    this.#manager = manager;
    this.#manifestIds = manifestIds;
    this.#maxConcurrent = options.maxConcurrent;
    this.#maxContextTokens = options.maxContextTokens;
    this.#requiredCompletionCommand = options.requiredCompletionCommand ?? DEFAULT_REQUIRED_COMPLETION_COMMAND;
  }

  async runOnce(): Promise<readonly RuntimeDispatchOutcome[]> {
    const candidates = await this.#candidates.listCandidates(this.#maxConcurrent);
    return Promise.all(candidates.map((candidate) => this.#execute(candidate)));
  }

  async #execute(candidate: RuntimeDispatchCandidate): Promise<RuntimeDispatchOutcome> {
    try {
      const policy = await this.#policies.resolve(candidate);
      if (!policy.allowedCommandTypes.includes(this.#requiredCompletionCommand)) {
        return {
          status: "skipped",
          organizationId: candidate.organizationId,
          runId: candidate.runId,
          reason: `Agent lacks ALLOW authority for required completion command ${this.#requiredCompletionCommand}`,
        };
      }

      const report = await this.#manager.execute({
        organizationId: candidate.organizationId,
        runId: candidate.runId,
        agent: candidate.agent,
        manifestId: this.#manifestIds.next(candidate),
        maxContextTokens: this.#maxContextTokens,
        heartbeatIntervalMs: Math.max(1, Math.floor((candidate.heartbeatIntervalSeconds * 1_000) / 2)),
        policy,
      });
      return {
        status: "executed",
        organizationId: candidate.organizationId,
        runId: candidate.runId,
        report,
      };
    } catch (error) {
      if (error instanceof KernelLifecycleCommandError) {
        return {
          status: "contended",
          organizationId: candidate.organizationId,
          runId: candidate.runId,
          reason: error.message,
        };
      }
      return {
        status: "failed",
        organizationId: candidate.organizationId,
        runId: candidate.runId,
        reason: boundedError(error),
      };
    }
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runRuntimeDispatcherLoop(
  dispatcher: RuntimeDispatcher,
  options: {
    readonly signal: AbortSignal;
    readonly idleDelayMs: number;
    readonly onOutcomes?: (outcomes: readonly RuntimeDispatchOutcome[]) => void;
    readonly onError?: (error: unknown) => void;
  },
): Promise<void> {
  while (!options.signal.aborted) {
    try {
      const outcomes = await dispatcher.runOnce();
      options.onOutcomes?.(outcomes);
    } catch (error) {
      options.onError?.(error);
    }
    await abortableDelay(options.idleDelayMs, options.signal);
  }
}

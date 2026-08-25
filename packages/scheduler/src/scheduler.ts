import {
  AOP_PROTOCOL_VERSION,
  CommandResultSchema,
  type AgentId,
  type CommandResult,
  type OrganizationId,
  type TaskId,
} from "@aop/protocol";

import { deterministicPrefixedUlid } from "./ids.js";

export interface SchedulerCandidate {
  readonly organizationId: OrganizationId;
  readonly taskId: TaskId;
  readonly taskRevision: number;
  readonly taskUpdatedAt: string;
  readonly priority: "critical" | "high" | "medium" | "low";
  readonly agentId: AgentId;
  readonly runtimeType: string;
  readonly attempt: number;
}

export interface SchedulerCandidateStore {
  listCandidates(limit: number, now: string): Promise<readonly SchedulerCandidate[]>;
}

export interface SchedulerCommandExecutor {
  execute(input: unknown): Promise<CommandResult>;
}

export interface SchedulerOptions {
  readonly store: SchedulerCandidateStore;
  readonly executor: SchedulerCommandExecutor;
  readonly now: () => string;
  readonly candidateLimit?: number;
  readonly leaseSeconds?: number;
  readonly heartbeatIntervalSeconds?: number;
}

export interface SchedulerRunResult {
  readonly attempted: number;
  readonly claimed?: SchedulerCandidate;
  readonly commandResult?: CommandResult;
}

function buildClaimCommand(
  candidate: SchedulerCandidate,
  now: string,
  leaseSeconds: number,
  heartbeatIntervalSeconds: number,
) {
  const seed = `${candidate.organizationId}:${candidate.taskId}:${candidate.taskRevision}:${candidate.agentId}:${candidate.attempt}`;
  const commandId = deterministicPrefixedUlid("cmd", candidate.taskUpdatedAt, `${seed}:command`);
  const runId = deterministicPrefixedUlid("run", candidate.taskUpdatedAt, `${seed}:run`);
  const leaseId = deterministicPrefixedUlid("lea", candidate.taskUpdatedAt, `${seed}:lease`);

  return {
    schemaVersion: 1 as const,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId,
    type: "task.claim",
    organizationId: candidate.organizationId,
    actor: { type: "system" as const, id: "scheduler" as const },
    target: { type: "task" as const, id: candidate.taskId },
    expectedRevision: candidate.taskRevision,
    idempotencyKey: `scheduler.claim:${candidate.taskId}:${candidate.taskRevision}:${candidate.agentId}:${candidate.attempt}`,
    payload: {
      agentId: candidate.agentId,
      runId,
      leaseId,
      attempt: candidate.attempt,
      runtimeType: candidate.runtimeType,
      workspaceId: `task:${candidate.taskId}:attempt:${candidate.attempt}`,
      leaseSeconds,
      heartbeatIntervalSeconds,
    },
    issuedAt: now,
  };
}

export class DeterministicScheduler {
  readonly #options: Required<Pick<SchedulerOptions, "candidateLimit" | "leaseSeconds" | "heartbeatIntervalSeconds">> &
    Omit<SchedulerOptions, "candidateLimit" | "leaseSeconds" | "heartbeatIntervalSeconds">;

  constructor(options: SchedulerOptions) {
    this.#options = {
      ...options,
      candidateLimit: options.candidateLimit ?? 32,
      leaseSeconds: options.leaseSeconds ?? 300,
      heartbeatIntervalSeconds: options.heartbeatIntervalSeconds ?? 60,
    };
    if (this.#options.candidateLimit < 1 || this.#options.candidateLimit > 500) {
      throw new RangeError("candidateLimit must be between 1 and 500");
    }
    if (this.#options.heartbeatIntervalSeconds >= this.#options.leaseSeconds) {
      throw new RangeError("heartbeatIntervalSeconds must be shorter than leaseSeconds");
    }
  }

  async runOnce(): Promise<SchedulerRunResult> {
    const now = this.#options.now();
    const candidates = await this.#options.store.listCandidates(this.#options.candidateLimit, now);
    let attempted = 0;
    let lastResult: CommandResult | undefined;

    for (const candidate of candidates) {
      attempted += 1;
      const result = CommandResultSchema.parse(
        await this.#options.executor.execute(
          buildClaimCommand(
            candidate,
            now,
            this.#options.leaseSeconds,
            this.#options.heartbeatIntervalSeconds,
          ),
        ),
      );
      lastResult = result;
      if (result.ok) {
        return { attempted, claimed: candidate, commandResult: result };
      }

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

import type {
  Agent,
  AgentId,
  CommandResult,
  ContextManifest,
  ContextManifestId,
  OrganizationId,
  ResourceRef,
  RuntimeTraceRef as ProtocolRuntimeTraceRef,
  RuntimeUsage as ProtocolRuntimeUsage,
  TaskRunId,
} from "@aop/protocol";

const COMMAND_TYPE_PATTERN = /^[a-z][a-z0-9_.:-]+$/;

export interface RuntimeExecutionPolicy {
  readonly allowedCommandTypes: readonly string[];
  readonly allowedToolCapabilities: readonly string[];
  readonly maxOutputTokens?: number;
  readonly maxToolCalls?: number;
}

export type RuntimeUsage = ProtocolRuntimeUsage;
export type RuntimeTraceRef = ProtocolRuntimeTraceRef;

export interface RuntimeCommandProposal {
  readonly type: string;
  readonly target?: ResourceRef;
  readonly expectedRevision?: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RuntimePrepareInput {
  readonly organizationId: OrganizationId;
  readonly runId: TaskRunId;
  readonly agent: Agent;
  readonly policy: RuntimeExecutionPolicy;
}

export interface PreparedRuntime {
  readonly runtimeId: string;
  readonly adapter: string;
  readonly provider?: string;
  readonly model?: string;
  readonly traceRefs: readonly RuntimeTraceRef[];
}

export interface RuntimeStartInput {
  readonly prepared: PreparedRuntime;
  readonly organizationId: OrganizationId;
  readonly runId: TaskRunId;
  readonly agent: Agent;
  readonly context: ContextManifest;
  readonly policy: RuntimeExecutionPolicy;
}

export interface RuntimeExecutionResult {
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly commandProposals: readonly RuntimeCommandProposal[];
  readonly output?: unknown;
  readonly usage: RuntimeUsage;
  readonly traceRefs: readonly RuntimeTraceRef[];
  readonly failureReason?: string;
}

export interface RuntimeInspection {
  readonly status: "prepared" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  readonly usage?: RuntimeUsage;
  readonly traceRefs: readonly RuntimeTraceRef[];
}

export interface RuntimeAdapter {
  readonly name: string;
  prepare(input: RuntimePrepareInput): Promise<PreparedRuntime>;
  start(input: RuntimeStartInput): Promise<RuntimeExecutionResult>;
  cancel(runtimeId: string, reason?: string): Promise<void>;
  inspect(runtimeId: string): Promise<RuntimeInspection>;
}

export interface ContextManifestProvider {
  getOrCompile(input: {
    readonly organizationId: OrganizationId;
    readonly runId: TaskRunId;
    readonly manifestId: ContextManifestId;
    readonly maxTokens: number;
  }): Promise<ContextManifest>;
}

export interface KernelCommandSubmission {
  readonly organizationId: OrganizationId;
  readonly runId: TaskRunId;
  readonly agentId: AgentId;
  readonly proposalIndex: number;
  readonly proposal: RuntimeCommandProposal;
}

export interface RuntimeCommandOutcome {
  readonly proposalIndex: number;
  readonly proposal: RuntimeCommandProposal;
  readonly forwarded: boolean;
  readonly result?: CommandResult;
  readonly denialReason?: string;
}

export interface KernelRuntimePort {
  /**
   * Implementations are trusted control-plane adapters. They must persist lifecycle
   * changes through the Kernel command/domain transaction boundary, never by giving
   * a provider runtime direct database access.
   */
  recordPrepared(input: {
    readonly organizationId: OrganizationId;
    readonly runId: TaskRunId;
    readonly agentId: AgentId;
    readonly runtimeId: string;
    readonly adapter: string;
    readonly provider?: string;
    readonly model?: string;
    readonly traceRefs: readonly RuntimeTraceRef[];
  }): Promise<void>;
  recordRunning(input: {
    readonly organizationId: OrganizationId;
    readonly runId: TaskRunId;
    readonly agentId: AgentId;
    readonly runtimeId: string;
  }): Promise<void>;
  heartbeat(input: {
    readonly organizationId: OrganizationId;
    readonly runId: TaskRunId;
    readonly agentId: AgentId;
    readonly runtimeId: string;
  }): Promise<void>;
  recordFinished(input: {
    readonly organizationId: OrganizationId;
    readonly runId: TaskRunId;
    readonly agentId: AgentId;
    readonly runtimeId: string;
    readonly contextManifestId?: ContextManifestId;
    readonly adapter?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly status: "succeeded" | "failed" | "cancelled";
    readonly usage: RuntimeUsage;
    readonly traceRefs: readonly RuntimeTraceRef[];
    readonly commandOutcomes: readonly RuntimeCommandOutcome[];
    readonly failureReason?: string;
  }): Promise<void>;
  submitAgentCommand(input: KernelCommandSubmission): Promise<CommandResult>;
}

export interface ExecuteRuntimeInput {
  readonly organizationId: OrganizationId;
  readonly runId: TaskRunId;
  readonly agent: Agent;
  readonly manifestId: ContextManifestId;
  readonly maxContextTokens: number;
  readonly policy: RuntimeExecutionPolicy;
}

export interface RuntimeRunReport {
  readonly organizationId: OrganizationId;
  readonly runId: TaskRunId;
  readonly agentId: AgentId;
  readonly contextManifestId?: ContextManifestId;
  readonly runtimeId: string;
  readonly adapter: string;
  readonly provider?: string;
  readonly model?: string;
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly usage: RuntimeUsage;
  readonly traceRefs: readonly RuntimeTraceRef[];
  readonly commandOutcomes: readonly RuntimeCommandOutcome[];
  readonly output?: unknown;
  readonly failureReason?: string;
}

function assertNonNegativeInteger(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
}

function validatePolicy(policy: RuntimeExecutionPolicy): void {
  assertNonNegativeInteger(policy.maxOutputTokens, "maxOutputTokens");
  assertNonNegativeInteger(policy.maxToolCalls, "maxToolCalls");
  const invalid = policy.allowedCommandTypes.find((type) => !COMMAND_TYPE_PATTERN.test(type));
  if (invalid !== undefined) throw new TypeError(`Invalid allowed command type: ${invalid}`);
}

function validateManifestIdentity(input: ExecuteRuntimeInput, manifest: ContextManifest): void {
  if (
    manifest.organizationId !== input.organizationId ||
    manifest.runId !== input.runId ||
    manifest.agentId !== input.agent.id ||
    manifest.id !== input.manifestId
  ) {
    throw new Error("Context Manifest identity does not match Runtime execution identity");
  }
}

function validateUsage(usage: RuntimeUsage): void {
  assertNonNegativeInteger(usage.inputTokens, "usage.inputTokens");
  assertNonNegativeInteger(usage.outputTokens, "usage.outputTokens");
  assertNonNegativeInteger(usage.toolCalls, "usage.toolCalls");
  if (usage.costCredits !== undefined && (!Number.isFinite(usage.costCredits) || usage.costCredits < 0)) {
    throw new TypeError("usage.costCredits must be non-negative");
  }
}

function normalizeFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.slice(0, 2_000);
  return "Runtime adapter failed without a structured error";
}

function boundedFailure(prefix: string, error: unknown): string {
  return `${prefix}: ${normalizeFailure(error)}`.slice(0, 2_000);
}

function traceUnion(...groups: readonly (readonly RuntimeTraceRef[])[]): RuntimeTraceRef[] {
  const seen = new Set<string>();
  const result: RuntimeTraceRef[] = [];
  for (const group of groups) {
    for (const trace of group) {
      const key = `${trace.provider}:${trace.traceId}:${trace.spanId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(trace);
    }
  }
  return result;
}

export class RuntimeManager {
  readonly #context: ContextManifestProvider;
  readonly #kernel: KernelRuntimePort;
  readonly #adapter: RuntimeAdapter;
  readonly #now: () => string;

  constructor(
    context: ContextManifestProvider,
    kernel: KernelRuntimePort,
    adapter: RuntimeAdapter,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#context = context;
    this.#kernel = kernel;
    this.#adapter = adapter;
    this.#now = now;
  }

  async execute(input: ExecuteRuntimeInput): Promise<RuntimeRunReport> {
    validatePolicy(input.policy);
    assertNonNegativeInteger(input.maxContextTokens, "maxContextTokens");

    const prepared = await this.#adapter.prepare({
      organizationId: input.organizationId,
      runId: input.runId,
      agent: input.agent,
      policy: input.policy,
    });
    if (prepared.runtimeId.trim().length === 0) throw new Error("Runtime adapter returned an empty runtimeId");
    if (prepared.adapter !== this.#adapter.name) {
      throw new Error("Runtime adapter identity mismatch during prepare");
    }

    try {
      await this.#kernel.recordPrepared({
        organizationId: input.organizationId,
        runId: input.runId,
        agentId: input.agent.id,
        runtimeId: prepared.runtimeId,
        adapter: prepared.adapter,
        ...(prepared.provider === undefined ? {} : { provider: prepared.provider }),
        ...(prepared.model === undefined ? {} : { model: prepared.model }),
        traceRefs: prepared.traceRefs,
      });
      await this.#kernel.recordRunning({
        organizationId: input.organizationId,
        runId: input.runId,
        agentId: input.agent.id,
        runtimeId: prepared.runtimeId,
      });
    } catch (error) {
      try {
        await this.#adapter.cancel(prepared.runtimeId, "kernel_lifecycle_record_failed");
      } catch {
        // Preserve the trusted control-plane failure as the primary error.
      }
      throw error;
    }

    const startedAt = this.#now();
    let context: ContextManifest;
    try {
      context = await this.#context.getOrCompile({
        organizationId: input.organizationId,
        runId: input.runId,
        manifestId: input.manifestId,
        maxTokens: input.maxContextTokens,
      });
      validateManifestIdentity(input, context);
    } catch (error) {
      const failureReason = boundedFailure("Context compilation failed", error);
      try {
        await this.#adapter.cancel(prepared.runtimeId, "context_compile_failed");
      } catch {
        // The authoritative failed Run Report remains the primary recovery record.
      }
      const traceRefs = traceUnion(prepared.traceRefs);
      const usage: RuntimeUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0 };
      await this.#kernel.recordFinished({
        organizationId: input.organizationId,
        runId: input.runId,
        agentId: input.agent.id,
        runtimeId: prepared.runtimeId,
        adapter: prepared.adapter,
        ...(prepared.provider === undefined ? {} : { provider: prepared.provider }),
        ...(prepared.model === undefined ? {} : { model: prepared.model }),
        status: "failed",
        usage,
        traceRefs,
        commandOutcomes: [],
        failureReason,
      });
      return {
        organizationId: input.organizationId,
        runId: input.runId,
        agentId: input.agent.id,
        runtimeId: prepared.runtimeId,
        adapter: prepared.adapter,
        ...(prepared.provider === undefined ? {} : { provider: prepared.provider }),
        ...(prepared.model === undefined ? {} : { model: prepared.model }),
        status: "failed",
        startedAt,
        finishedAt: this.#now(),
        usage,
        traceRefs,
        commandOutcomes: [],
        failureReason,
      };
    }

    let execution: RuntimeExecutionResult;
    try {
      execution = await this.#adapter.start({
        prepared,
        organizationId: input.organizationId,
        runId: input.runId,
        agent: input.agent,
        context,
        policy: input.policy,
      });
      validateUsage(execution.usage);
      if (input.policy.maxToolCalls !== undefined && execution.usage.toolCalls > input.policy.maxToolCalls) {
        execution = {
          ...execution,
          status: "failed",
          commandProposals: [],
          failureReason: `Runtime exceeded maxToolCalls (${execution.usage.toolCalls} > ${input.policy.maxToolCalls})`,
        };
      }
      if (input.policy.maxOutputTokens !== undefined && execution.usage.outputTokens > input.policy.maxOutputTokens) {
        execution = {
          ...execution,
          status: "failed",
          commandProposals: [],
          failureReason: `Runtime exceeded maxOutputTokens (${execution.usage.outputTokens} > ${input.policy.maxOutputTokens})`,
        };
      }
    } catch (error) {
      execution = {
        status: "failed",
        commandProposals: [],
        usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0 },
        traceRefs: [],
        failureReason: normalizeFailure(error),
      };
    }

    const commandOutcomes: RuntimeCommandOutcome[] = [];
    if (execution.status === "succeeded") {
      const allowed = new Set(input.policy.allowedCommandTypes);
      for (const [proposalIndex, proposal] of execution.commandProposals.entries()) {
        if (!COMMAND_TYPE_PATTERN.test(proposal.type)) {
          commandOutcomes.push({
            proposalIndex,
            proposal,
            forwarded: false,
            denialReason: "invalid_command_type",
          });
          continue;
        }
        if (!allowed.has(proposal.type)) {
          commandOutcomes.push({
            proposalIndex,
            proposal,
            forwarded: false,
            denialReason: "command_not_allowed_by_execution_policy",
          });
          continue;
        }
        try {
          const result = await this.#kernel.submitAgentCommand({
            organizationId: input.organizationId,
            runId: input.runId,
            agentId: input.agent.id,
            proposalIndex,
            proposal,
          });
          commandOutcomes.push({ proposalIndex, proposal, forwarded: true, result });
        } catch (error) {
          const reason = normalizeFailure(error);
          commandOutcomes.push({
            proposalIndex,
            proposal,
            forwarded: true,
            denialReason: `kernel_submission_failed:${reason}`,
          });
          execution = {
            ...execution,
            status: "failed",
            commandProposals: [],
            failureReason: `Kernel command submission failed for proposal ${proposalIndex}: ${reason}`,
          };
          break;
        }
      }
    }

    const traceRefs = traceUnion(prepared.traceRefs, execution.traceRefs);
    await this.#kernel.recordFinished({
      organizationId: input.organizationId,
      runId: input.runId,
      agentId: input.agent.id,
      runtimeId: prepared.runtimeId,
      contextManifestId: context.id,
      adapter: prepared.adapter,
      ...(prepared.provider === undefined ? {} : { provider: prepared.provider }),
      ...(prepared.model === undefined ? {} : { model: prepared.model }),
      status: execution.status,
      usage: execution.usage,
      traceRefs,
      commandOutcomes,
      ...(execution.failureReason === undefined ? {} : { failureReason: execution.failureReason }),
    });

    return {
      organizationId: input.organizationId,
      runId: input.runId,
      agentId: input.agent.id,
      contextManifestId: context.id,
      runtimeId: prepared.runtimeId,
      adapter: prepared.adapter,
      ...(prepared.provider === undefined ? {} : { provider: prepared.provider }),
      ...(prepared.model === undefined ? {} : { model: prepared.model }),
      status: execution.status,
      startedAt,
      finishedAt: this.#now(),
      usage: execution.usage,
      traceRefs,
      commandOutcomes,
      ...(execution.output === undefined ? {} : { output: execution.output }),
      ...(execution.failureReason === undefined ? {} : { failureReason: execution.failureReason }),
    };
  }

  async heartbeat(input: {
    readonly organizationId: OrganizationId;
    readonly runId: TaskRunId;
    readonly agentId: AgentId;
    readonly runtimeId: string;
  }): Promise<void> {
    await this.#kernel.heartbeat(input);
  }

  async cancel(input: {
    readonly organizationId: OrganizationId;
    readonly runId: TaskRunId;
    readonly agentId: AgentId;
    readonly runtimeId: string;
    readonly reason?: string;
  }): Promise<void> {
    await this.#adapter.cancel(input.runtimeId, input.reason);
    await this.#kernel.recordFinished({
      organizationId: input.organizationId,
      runId: input.runId,
      agentId: input.agentId,
      runtimeId: input.runtimeId,
      status: "cancelled",
      usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0 },
      traceRefs: [],
      commandOutcomes: [],
      ...(input.reason === undefined ? {} : { failureReason: input.reason }),
    });
  }

  inspect(runtimeId: string): Promise<RuntimeInspection> {
    return this.#adapter.inspect(runtimeId);
  }
}

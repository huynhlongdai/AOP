import {
  AOP_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  RuntimeCommandOutcomeEvidenceSchema,
  type AgentId,
  type CommandResult,
  type ContextManifestId,
  type LeaseId,
  type LeaseStatus,
  type OrganizationId,
  type RuntimeCommandOutcomeEvidence,
  type TaskId,
  type TaskRunId,
  type TaskRunStatus,
  type TaskState,
} from "@aop/protocol";

import {
  GatewayAgentCommandBridge,
  type CommandGatewayLike,
  type RuntimeCommandIdSource,
} from "./agent-command-bridge.js";
import type {
  KernelCommandSubmission,
  KernelRuntimePort,
  RuntimeCommandOutcome,
} from "./runtime-manager.js";

export interface RuntimeExecutionControlState {
  readonly organizationId: OrganizationId;
  readonly runId: TaskRunId;
  readonly taskId: TaskId;
  readonly agentId: AgentId;
  readonly runStatus: TaskRunStatus;
  readonly runRevision: number;
  readonly runtimeType: string;
  readonly runtimeId?: string;
  readonly taskState: TaskState;
  readonly taskRevision: number;
  readonly leaseId: LeaseId;
  readonly leaseStatus: LeaseStatus;
  readonly leaseRevision: number;
  readonly heartbeatIntervalSeconds: number;
  readonly contextManifestId?: ContextManifestId;
}

export interface RuntimeExecutionStateReader {
  getRuntimeExecutionState(
    organizationId: OrganizationId,
    runId: TaskRunId,
  ): Promise<RuntimeExecutionControlState | undefined>;
}

export class KernelLifecycleCommandError extends Error {
  readonly result: CommandResult;

  constructor(action: string, result: CommandResult) {
    const detail = result.ok ? "unexpected accepted result" : `${result.error.code}: ${result.error.message}`;
    super(`Kernel lifecycle ${action} failed: ${detail}`);
    this.name = "KernelLifecycleCommandError";
    this.result = result;
  }
}

function assertStateIdentity(
  state: RuntimeExecutionControlState,
  input: { organizationId: OrganizationId; runId: TaskRunId; agentId: AgentId; runtimeId?: string },
): void {
  if (state.organizationId !== input.organizationId || state.runId !== input.runId || state.agentId !== input.agentId) {
    throw new Error("Runtime execution state identity mismatch");
  }
  if (input.runtimeId !== undefined && state.runtimeId !== undefined && state.runtimeId !== input.runtimeId) {
    throw new Error("Runtime execution state runtimeId mismatch");
  }
}

function outcomeEvidence(outcome: RuntimeCommandOutcome): RuntimeCommandOutcomeEvidence {
  const common = {
    proposalIndex: outcome.proposalIndex,
    commandType: outcome.proposal.type,
    ...(outcome.proposal.target === undefined ? {} : { target: outcome.proposal.target }),
  };

  if (!outcome.forwarded) {
    return RuntimeCommandOutcomeEvidenceSchema.parse({
      ...common,
      status: "not_forwarded",
      reason: outcome.denialReason ?? "runtime_execution_policy_denied",
    });
  }

  if (outcome.result === undefined) {
    return RuntimeCommandOutcomeEvidenceSchema.parse({
      ...common,
      status: "submission_error",
      reason: outcome.denialReason ?? "kernel_submission_failed_without_result",
    });
  }

  if (outcome.result.ok) {
    return RuntimeCommandOutcomeEvidenceSchema.parse({
      ...common,
      status: "accepted",
      commandId: outcome.result.commandId,
    });
  }

  return RuntimeCommandOutcomeEvidenceSchema.parse({
    ...common,
    status: "rejected",
    commandId: outcome.result.commandId,
    errorCode: outcome.result.error.code,
    reason: outcome.result.error.message,
  });
}

export class GatewayKernelRuntimePort implements KernelRuntimePort {
  readonly #gateway: CommandGatewayLike;
  readonly #state: RuntimeExecutionStateReader;
  readonly #ids: RuntimeCommandIdSource;
  readonly #agentCommands: GatewayAgentCommandBridge;
  readonly #now: () => string;

  constructor(
    gateway: CommandGatewayLike,
    state: RuntimeExecutionStateReader,
    ids: RuntimeCommandIdSource,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#gateway = gateway;
    this.#state = state;
    this.#ids = ids;
    this.#agentCommands = new GatewayAgentCommandBridge(gateway, ids, now);
    this.#now = now;
  }

  async #current(
    organizationId: OrganizationId,
    runId: TaskRunId,
  ): Promise<RuntimeExecutionControlState> {
    const state = await this.#state.getRuntimeExecutionState(organizationId, runId);
    if (state === undefined) throw new Error(`Runtime execution state not found for ${runId}`);
    return state;
  }

  async #executeLifecycle(input: {
    readonly type: string;
    readonly organizationId: OrganizationId;
    readonly runId: TaskRunId;
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly targetType: "task_run" | "lease";
    readonly targetId: string;
  }): Promise<void> {
    const result = await this.#gateway.execute(
      CommandEnvelopeSchema.parse({
        schemaVersion: 1,
        protocolVersion: AOP_PROTOCOL_VERSION,
        commandId: this.#ids.nextCommandId(),
        type: input.type,
        organizationId: input.organizationId,
        actor: { type: "system", id: "runtime-manager" },
        target: { type: input.targetType, id: input.targetId },
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        issuedAt: this.#now(),
      }),
    );
    if (!result.ok) throw new KernelLifecycleCommandError(input.type, result);
  }

  async recordPrepared(input: Parameters<KernelRuntimePort["recordPrepared"]>[0]): Promise<void> {
    const state = await this.#current(input.organizationId, input.runId);
    assertStateIdentity(state, input);
    if (state.runStatus !== "created" || state.taskState !== "leased" || state.leaseStatus !== "active") {
      throw new Error("Runtime preparation requires created Run, leased Task and active Lease");
    }
    if (state.runtimeType !== input.adapter) throw new Error("Runtime adapter does not match TaskRun runtimeType");
    if (state.contextManifestId !== undefined && state.contextManifestId !== input.contextManifestId) {
      throw new Error("Runtime preparation Context Manifest differs from authoritative Run manifest");
    }

    await this.#executeLifecycle({
      type: "task_run.prepare",
      organizationId: input.organizationId,
      runId: input.runId,
      expectedRevision: state.runRevision,
      idempotencyKey: `runtime:${input.runId}:prepare`,
      targetType: "task_run",
      targetId: input.runId,
      payload: {
        runtimeId: input.runtimeId,
        contextManifestId: input.contextManifestId,
        adapter: input.adapter,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        traceRefs: input.traceRefs,
      },
    });
  }

  async recordRunning(input: Parameters<KernelRuntimePort["recordRunning"]>[0]): Promise<void> {
    const state = await this.#current(input.organizationId, input.runId);
    assertStateIdentity(state, input);
    if (state.runStatus !== "preparing" || state.taskState !== "leased" || state.leaseStatus !== "active") {
      throw new Error("Runtime start requires preparing Run, leased Task and active Lease");
    }
    if (state.runtimeId !== input.runtimeId) throw new Error("Prepared runtimeId changed before Runtime start");

    await this.#executeLifecycle({
      type: "task_run.start",
      organizationId: input.organizationId,
      runId: input.runId,
      expectedRevision: state.runRevision,
      idempotencyKey: `runtime:${input.runId}:start`,
      targetType: "task_run",
      targetId: input.runId,
      payload: { taskExpectedRevision: state.taskRevision },
    });
  }

  async heartbeat(input: Parameters<KernelRuntimePort["heartbeat"]>[0]): Promise<void> {
    const state = await this.#current(input.organizationId, input.runId);
    assertStateIdentity(state, input);
    if (state.leaseStatus !== "active") throw new Error("Cannot heartbeat a Runtime without an active Lease");
    if (state.runtimeId !== input.runtimeId) throw new Error("Runtime heartbeat runtimeId mismatch");
    const extendSeconds = Math.min(3_600, Math.max(30, state.heartbeatIntervalSeconds * 2));

    await this.#executeLifecycle({
      type: "lease.heartbeat",
      organizationId: input.organizationId,
      runId: input.runId,
      expectedRevision: state.leaseRevision,
      idempotencyKey: `runtime:${input.runId}:heartbeat:${state.leaseRevision}`,
      targetType: "lease",
      targetId: state.leaseId,
      payload: { extendSeconds },
    });
  }

  async recordFinished(input: Parameters<KernelRuntimePort["recordFinished"]>[0]): Promise<void> {
    const state = await this.#current(input.organizationId, input.runId);
    assertStateIdentity(state, input);
    if ((state.runStatus !== "running" && state.runStatus !== "paused") || state.leaseStatus !== "active") {
      throw new Error("Runtime finish requires active running/paused execution");
    }
    if (state.runtimeId !== input.runtimeId) throw new Error("Runtime finish runtimeId mismatch");

    const contextManifestId = input.contextManifestId ?? state.contextManifestId;
    if (contextManifestId === undefined) throw new Error("Runtime finish requires authoritative Context Manifest identity");
    if (state.contextManifestId !== undefined && state.contextManifestId !== contextManifestId) {
      throw new Error("Runtime finish Context Manifest differs from authoritative Run manifest");
    }
    const adapter = input.adapter ?? state.runtimeType;
    if (adapter !== state.runtimeType) throw new Error("Runtime finish adapter differs from TaskRun runtimeType");

    const commandOutcomes = [...input.commandOutcomes]
      .sort((left, right) => left.proposalIndex - right.proposalIndex)
      .map(outcomeEvidence);

    await this.#executeLifecycle({
      type: "task_run.finish",
      organizationId: input.organizationId,
      runId: input.runId,
      expectedRevision: state.runRevision,
      idempotencyKey: `runtime:${input.runId}:finish`,
      targetType: "task_run",
      targetId: input.runId,
      payload: {
        taskExpectedRevision: state.taskRevision,
        contextManifestId,
        runtimeId: input.runtimeId,
        adapter,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        status: input.status,
        usage: input.usage,
        traceRefs: input.traceRefs,
        commandOutcomes,
        ...(input.failureReason === undefined ? {} : { failureReason: input.failureReason }),
      },
    });
  }

  submitAgentCommand(input: KernelCommandSubmission): Promise<CommandResult> {
    return this.#agentCommands.submit(input);
  }
}

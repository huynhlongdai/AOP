import {
  AOP_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  type CommandId,
  type CommandResult,
} from "@aop/protocol";

import type { KernelCommandSubmission } from "./runtime-manager.js";

export interface CommandGatewayLike {
  execute(input: unknown): Promise<CommandResult>;
}

export interface RuntimeCommandIdSource {
  nextCommandId(): CommandId;
}

function runtimeIdempotencyKey(input: KernelCommandSubmission): string {
  if (!Number.isSafeInteger(input.proposalIndex) || input.proposalIndex < 0) {
    throw new TypeError("proposalIndex must be a non-negative safe integer");
  }
  return `runtime:${input.runId}:proposal:${input.proposalIndex}`;
}

/**
 * Trusted bridge between an untrusted provider/runtime proposal and the AOP
 * Command Gateway. Runtime output never supplies actor, organization, commandId,
 * protocol metadata or idempotency identity; those fields are bound here from
 * trusted execution state before policy/domain evaluation.
 */
export class GatewayAgentCommandBridge {
  readonly #gateway: CommandGatewayLike;
  readonly #ids: RuntimeCommandIdSource;
  readonly #now: () => string;

  constructor(gateway: CommandGatewayLike, ids: RuntimeCommandIdSource, now: () => string = () => new Date().toISOString()) {
    this.#gateway = gateway;
    this.#ids = ids;
    this.#now = now;
  }

  async submit(input: KernelCommandSubmission): Promise<CommandResult> {
    const envelope = CommandEnvelopeSchema.parse({
      schemaVersion: 1,
      protocolVersion: AOP_PROTOCOL_VERSION,
      commandId: this.#ids.nextCommandId(),
      type: input.proposal.type,
      organizationId: input.organizationId,
      actor: { type: "agent", id: input.agentId },
      ...(input.proposal.target === undefined ? {} : { target: input.proposal.target }),
      ...(input.proposal.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.proposal.expectedRevision }),
      idempotencyKey: runtimeIdempotencyKey(input),
      payload: input.proposal.payload,
      issuedAt: this.#now(),
    });

    return this.#gateway.execute(envelope);
  }
}

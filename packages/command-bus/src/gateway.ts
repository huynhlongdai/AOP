import { DomainError } from "@aop/domain";
import { evaluatePolicy } from "@aop/policy-engine";
import {
  CommandEnvelopeSchema,
  CommandResultSchema,
  EventEnvelopeSchema,
  type ApprovalRequest,
  type CommandEnvelope,
  type CommandResult,
  type ProtocolErrorCode,
} from "@aop/protocol";

import type {
  ApprovalSpec,
  CommandGatewayDependencies,
  CommandHandler,
  CommandTransaction,
  EventDraft,
} from "./contracts.js";

export class CommandEnvelopeValidationError extends Error {
  readonly issues: readonly unknown[];

  constructor(issues: readonly unknown[]) {
    super("Command envelope failed protocol validation");
    this.name = "CommandEnvelopeValidationError";
    this.issues = issues;
  }
}

function rejected(
  command: CommandEnvelope,
  code: ProtocolErrorCode,
  message: string,
  retryable: boolean,
  details: Readonly<Record<string, unknown>> = {},
  approvalRequestId?: ApprovalRequest["id"],
): CommandResult {
  return CommandResultSchema.parse({
    ok: false,
    commandId: command.commandId,
    error: {
      code,
      message,
      retryable,
      details,
      ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
    },
  });
}

function domainRejected(command: CommandEnvelope, error: DomainError): CommandResult {
  return rejected(
    command,
    error.code,
    error.message,
    error.code === "revision_conflict",
    error.details,
  );
}

function findHandler(handlers: readonly CommandHandler[], type: string): CommandHandler | undefined {
  return handlers.find((handler) => handler.type === type);
}

function policyResolutionIsBoundToCommand(
  command: CommandEnvelope,
  capability: string,
  transactionResolution: Awaited<ReturnType<CommandGatewayDependencies["authorization"]["resolve"]>>,
): boolean {
  const input = transactionResolution.policyInput;
  return (
    input.organizationId === command.organizationId &&
    input.capability === capability &&
    input.principal.type === command.actor.type &&
    input.principal.id === command.actor.id
  );
}

function buildApproval(
  command: CommandEnvelope,
  id: ApprovalRequest["id"],
  spec: ApprovalSpec,
  now: string,
): ApprovalRequest {
  return {
    id,
    organizationId: command.organizationId,
    commandId: command.commandId,
    commandType: command.type,
    requestedBy: command.actor,
    policyRule: spec.policyRule,
    requiredAuthority: spec.requiredAuthority,
    risk: spec.risk,
    evidence: [...spec.evidence],
    impactSummary: spec.impactSummary,
    status: "pending",
    revision: 0,
    createdAt: now,
    ...(command.target === undefined ? {} : { target: command.target }),
    ...(spec.estimatedCostCredits === undefined ? {} : { estimatedCostCredits: spec.estimatedCostCredits }),
    ...(spec.expiresAt === undefined ? {} : { expiresAt: spec.expiresAt }),
  };
}

async function persistEvent(
  deps: CommandGatewayDependencies,
  transaction: CommandTransaction,
  command: CommandEnvelope,
  draft: EventDraft,
): Promise<ReturnType<CommandGatewayDependencies["ids"]["nextEventId"]>> {
  const eventId = deps.ids.nextEventId();
  const organizationSequence = await transaction.nextOrganizationSequence(command.organizationId);
  const event = EventEnvelopeSchema.parse({
    schemaVersion: command.schemaVersion,
    protocolVersion: command.protocolVersion,
    eventId,
    type: draft.type,
    organizationId: command.organizationId,
    organizationSequence,
    aggregate: draft.aggregate,
    aggregateRevision: draft.aggregateRevision,
    actor: command.actor,
    causationId: command.commandId,
    correlationId: draft.correlationId,
    payload: draft.payload,
    occurredAt: deps.now(),
  });
  await transaction.appendEvent(event);
  await transaction.enqueueOutbox(event);
  return eventId;
}

export class CommandGateway {
  readonly #deps: CommandGatewayDependencies;

  constructor(deps: CommandGatewayDependencies) {
    const duplicateTypes = deps.handlers
      .map((handler) => handler.type)
      .filter((type, index, types) => types.indexOf(type) !== index);
    if (duplicateTypes.length > 0) {
      throw new Error(`Duplicate command handlers: ${[...new Set(duplicateTypes)].join(", ")}`);
    }
    this.#deps = deps;
  }

  async execute(input: unknown): Promise<CommandResult> {
    const parsed = CommandEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      throw new CommandEnvelopeValidationError(parsed.error.issues);
    }
    return this.#executeParsed(parsed.data);
  }

  async #recordDomainRejection(
    command: CommandEnvelope,
    requestDigest: string,
    result: CommandResult,
  ): Promise<CommandResult> {
    return this.#deps.store.transaction(async (transaction) => {
      const existing = await transaction.findDedup(command.organizationId, command.idempotencyKey);
      if (existing !== undefined) {
        if (existing.requestDigest !== requestDigest) {
          return rejected(command, "idempotency_conflict", "Idempotency key was reused with a different request", false, {
            originalCommandId: existing.commandId,
            originalCommandType: existing.commandType,
          });
        }
        if (existing.result !== undefined) return existing.result;
      } else {
        await transaction.beginDedup({
          organizationId: command.organizationId,
          idempotencyKey: command.idempotencyKey,
          commandId: command.commandId,
          commandType: command.type,
          actor: command.actor,
          requestDigest,
        });
      }
      await transaction.finishDedup(command.organizationId, command.idempotencyKey, "rejected", result);
      return result;
    });
  }

  async #executeParsed(command: CommandEnvelope): Promise<CommandResult> {
    const handler = findHandler(this.#deps.handlers, command.type);
    if (handler === undefined) {
      return rejected(command, "validation_error", `Unsupported command type: ${command.type}`, false, {
        commandType: command.type,
      });
    }

    if (handler.requiresExpectedRevision === true && command.expectedRevision === undefined) {
      return rejected(command, "validation_error", "Command requires expectedRevision", false, {
        commandType: command.type,
      });
    }

    const requestDigest = this.#deps.digest(command);

    try {
      return await this.#deps.store.transaction(async (transaction) => {
        const existing = await transaction.findDedup(command.organizationId, command.idempotencyKey);
        if (existing !== undefined) {
          if (existing.requestDigest !== requestDigest) {
            return rejected(command, "idempotency_conflict", "Idempotency key was reused with a different request", false, {
              originalCommandId: existing.commandId,
              originalCommandType: existing.commandType,
            });
          }
          if (existing.result !== undefined) return existing.result;
          return rejected(command, "internal_error", "Matching command is still processing", true, {
            originalCommandId: existing.commandId,
          });
        }

        if (
          command.target !== undefined &&
          !(await transaction.resourceBelongsToOrganization(command.organizationId, command.target))
        ) {
          return rejected(command, "scope_mismatch", "Command target does not belong to organization", false, {
            target: command.target,
          });
        }

        await transaction.beginDedup({
          organizationId: command.organizationId,
          idempotencyKey: command.idempotencyKey,
          commandId: command.commandId,
          commandType: command.type,
          actor: command.actor,
          requestDigest,
        });

        const resolution = await this.#deps.authorization.resolve(command, handler.capability, transaction);
        if (!policyResolutionIsBoundToCommand(command, handler.capability, resolution)) {
          const result = rejected(command, "internal_error", "Authorization resolver returned mismatched context", false);
          await transaction.finishDedup(command.organizationId, command.idempotencyKey, "rejected", result);
          return result;
        }

        const policy = evaluatePolicy(resolution.policyInput);
        if (policy.effect === "deny") {
          const result = rejected(command, "forbidden", policy.reason, false, {
            policySource: policy.source,
          });
          await transaction.finishDedup(command.organizationId, command.idempotencyKey, "rejected", result);
          return result;
        }

        if (policy.effect === "require_approval") {
          if (resolution.approval === undefined) {
            const result = rejected(
              command,
              "internal_error",
              "Approval-required policy is missing an approval specification",
              false,
            );
            await transaction.finishDedup(command.organizationId, command.idempotencyKey, "rejected", result);
            return result;
          }

          const approvalId = this.#deps.ids.nextApprovalRequestId();
          const approval = buildApproval(command, approvalId, resolution.approval, this.#deps.now());
          await transaction.createApprovalRequest(approval);
          const eventId = await persistEvent(this.#deps, transaction, command, {
            type: "approval.requested",
            aggregate: { type: "approval", id: approvalId },
            aggregateRevision: 0,
            correlationId: command.commandId,
            payload: {
              commandType: command.type,
              policyRule: resolution.approval.policyRule,
              risk: resolution.approval.risk,
            },
          });
          const result = rejected(command, "approval_required", policy.reason, false, { eventId }, approvalId);
          await transaction.finishDedup(command.organizationId, command.idempotencyKey, "approval_pending", result);
          return result;
        }

        const mutation = await handler.execute(command, transaction);
        if (mutation.events.length === 0) {
          throw new DomainError("invariant_violation", "Accepted mutation must emit at least one event");
        }

        const emittedEventIds = [];
        for (const draft of mutation.events) {
          emittedEventIds.push(await persistEvent(this.#deps, transaction, command, draft));
        }

        const result = CommandResultSchema.parse({
          ok: true,
          commandId: command.commandId,
          emittedEventIds,
          ...(mutation.resultingRevision === undefined ? {} : { resultingRevision: mutation.resultingRevision }),
        });
        await transaction.finishDedup(command.organizationId, command.idempotencyKey, "accepted", result);
        return result;
      });
    } catch (error) {
      if (error instanceof DomainError) {
        const result = domainRejected(command, error);
        try {
          return await this.#recordDomainRejection(command, requestDigest, result);
        } catch (recordError) {
          return rejected(command, "internal_error", "Command failed and rejection could not be recorded", true, {
            errorName: recordError instanceof Error ? recordError.name : "UnknownError",
          });
        }
      }
      return rejected(command, "internal_error", "Command execution failed", true, {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

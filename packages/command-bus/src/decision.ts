import {
  activateDecision,
  createDecision,
  DomainError,
  rejectDecision,
  requestDecisionApproval,
  supersedeDecision,
} from "@aop/domain";
import { evaluatePolicy } from "@aop/policy-engine";
import {
  DecisionActivatePayloadSchema,
  DecisionCreatePayloadSchema,
  DecisionRejectPayloadSchema,
  DecisionRequestApprovalPayloadSchema,
  type AgentId,
  type CommandEnvelope,
  type Decision,
  type DecisionId,
  type OrganizationId,
  type Permission,
  type Principal,
  type ResourceRef,
  type Role,
} from "@aop/protocol";

import type { CommandHandler, CommandMutation, CommandTransaction, EventDraft } from "./contracts.js";

export interface DecisionActivationBundle {
  readonly decision: Decision;
  readonly supersededDecision?: Decision;
}

export interface DecisionWriteTransaction extends CommandTransaction {
  lockDecisionCreateIdentity(organizationId: OrganizationId, decisionId: DecisionId): Promise<Decision | undefined>;
  lockDecision(organizationId: OrganizationId, decisionId: DecisionId): Promise<Decision | undefined>;
  lockDecisionActivationBundle(
    organizationId: OrganizationId,
    decisionId: DecisionId,
    supersedesDecisionId?: DecisionId,
  ): Promise<DecisionActivationBundle | undefined>;
  persistDecisionCreate(decision: Decision): Promise<void>;
  persistDecisionTransition(decision: Decision): Promise<void>;
  persistDecisionActivation(decision: Decision, supersededDecision?: Decision): Promise<void>;
  listPermissionsForPrincipal(organizationId: OrganizationId, principal: Principal): Promise<readonly Permission[]>;
  listActiveRolesForAgent(organizationId: OrganizationId, agentId: AgentId, now: string): Promise<readonly Role[]>;
}

function decisionTransaction(transaction: CommandTransaction): DecisionWriteTransaction {
  const candidate = transaction as Partial<DecisionWriteTransaction>;
  if (
    typeof candidate.lockDecisionCreateIdentity !== "function" ||
    typeof candidate.lockDecision !== "function" ||
    typeof candidate.lockDecisionActivationBundle !== "function" ||
    typeof candidate.persistDecisionCreate !== "function" ||
    typeof candidate.persistDecisionTransition !== "function" ||
    typeof candidate.persistDecisionActivation !== "function" ||
    typeof candidate.listPermissionsForPrincipal !== "function" ||
    typeof candidate.listActiveRolesForAgent !== "function"
  ) {
    throw new DomainError("internal_error", "Command store does not support Decision write transactions");
  }
  return transaction as DecisionWriteTransaction;
}

function targetDecisionId(command: CommandEnvelope): DecisionId {
  if (command.target?.type !== "decision") {
    throw new DomainError("validation_error", `${command.type} requires a Decision target`);
  }
  return command.target.id as DecisionId;
}

async function assertResourcesInOrganization(
  command: CommandEnvelope,
  transaction: CommandTransaction,
  resources: readonly ResourceRef[],
): Promise<void> {
  for (const resource of resources) {
    if (!(await transaction.resourceBelongsToOrganization(command.organizationId, resource))) {
      throw new DomainError("scope_mismatch", "Decision affected resource does not belong to the Organization", {
        resource,
      });
    }
  }
}

async function assertDecisionAuthority(
  command: CommandEnvelope,
  decision: Decision,
  tx: DecisionWriteTransaction,
  now: string,
): Promise<void> {
  const permissions = await tx.listPermissionsForPrincipal(command.organizationId, command.actor);
  const resolvedRoles =
    command.actor.type === "agent"
      ? await tx.listActiveRolesForAgent(command.organizationId, command.actor.id as AgentId, now)
      : ([] as readonly Role[]);

  const policy = evaluatePolicy({
    organizationId: command.organizationId,
    principal: command.actor,
    capability: decision.authorityCapability,
    permissions,
    resolvedRoles,
    resource: { type: "decision", id: decision.id },
    now,
    context: {
      commandType: command.type,
      decisionScope: decision.scope,
      authorityCapability: decision.authorityCapability,
    },
  });

  if (policy.effect !== "allow") {
    throw new DomainError("forbidden", "Actor lacks the Decision's required authority capability", {
      decisionId: decision.id,
      authorityCapability: decision.authorityCapability,
      policyEffect: policy.effect,
      policySource: policy.source,
    });
  }
}

export class DecisionCreateHandler implements CommandHandler {
  readonly type = "decision.create";
  readonly capability = "decision.create";

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    if (command.target !== undefined) {
      throw new DomainError("validation_error", "decision.create must not target an existing resource");
    }
    if (command.expectedRevision !== undefined) {
      throw new DomainError("validation_error", "decision.create must not include expectedRevision");
    }

    const payload = DecisionCreatePayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "decision.create payload is invalid", { issues: payload.error.issues });
    }

    const tx = decisionTransaction(transaction);
    const existing = await tx.lockDecisionCreateIdentity(command.organizationId, payload.data.decisionId);
    if (existing !== undefined) {
      throw new DomainError("invariant_violation", "Decision already exists", { decisionId: payload.data.decisionId });
    }

    await assertResourcesInOrganization(command, transaction, payload.data.affectedResources);

    if (payload.data.supersedesDecisionId !== undefined) {
      const current = await tx.lockDecision(command.organizationId, payload.data.supersedesDecisionId);
      if (current === undefined) {
        throw new DomainError("scope_mismatch", "supersedesDecisionId does not reference a Decision in this Organization", {
          supersedesDecisionId: payload.data.supersedesDecisionId,
        });
      }
      if (current.status !== "active") {
        throw new DomainError("invariant_violation", "A replacement Decision may only target an active Decision", {
          supersedesDecisionId: current.id,
          status: current.status,
        });
      }
      if (current.scope !== payload.data.scope || current.authorityCapability !== payload.data.authorityCapability) {
        throw new DomainError("invariant_violation", "Superseding Decisions must preserve scope and authority boundary", {
          supersedesDecisionId: current.id,
          previousScope: current.scope,
          nextScope: payload.data.scope,
          previousAuthorityCapability: current.authorityCapability,
          nextAuthorityCapability: payload.data.authorityCapability,
        });
      }
    }

    const timestamp = this.#now();
    const decision = createDecision({
      id: payload.data.decisionId,
      organizationId: command.organizationId,
      scope: payload.data.scope,
      question: payload.data.question,
      options: payload.data.options,
      proposedBy: command.actor,
      authorityCapability: payload.data.authorityCapability,
      status: "proposed",
      affectedResources: payload.data.affectedResources,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(payload.data.supersedesDecisionId === undefined
        ? {}
        : { supersedesDecisionId: payload.data.supersedesDecisionId }),
    });

    await tx.persistDecisionCreate(decision);

    return {
      resultingRevision: decision.revision,
      events: [
        {
          type: "decision.proposed",
          aggregate: { type: "decision", id: decision.id },
          aggregateRevision: decision.revision,
          correlationId: command.commandId,
          payload: {
            scope: decision.scope,
            authorityCapability: decision.authorityCapability,
            affectedResources: decision.affectedResources,
            supersedesDecisionId: decision.supersedesDecisionId ?? null,
          },
        },
      ],
    };
  }
}

export class DecisionRequestApprovalHandler implements CommandHandler {
  readonly type = "decision.request_approval";
  readonly capability = "decision.request_approval";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = DecisionRequestApprovalPayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "decision.request_approval payload is invalid", {
        issues: payload.error.issues,
      });
    }
    if (command.expectedRevision === undefined) {
      throw new DomainError("validation_error", "decision.request_approval requires expectedRevision");
    }

    const decisionId = targetDecisionId(command);
    const tx = decisionTransaction(transaction);
    const current = await tx.lockDecision(command.organizationId, decisionId);
    if (current === undefined) throw new DomainError("not_found", "Decision was not found", { decisionId });

    const updated = requestDecisionApproval(current, command.expectedRevision, this.#now());
    await tx.persistDecisionTransition(updated);

    return {
      resultingRevision: updated.revision,
      events: [
        {
          type: "decision.approval_requested",
          aggregate: { type: "decision", id: decisionId },
          aggregateRevision: updated.revision,
          correlationId: command.commandId,
          payload: { authorityCapability: updated.authorityCapability },
        },
      ],
    };
  }
}

export class DecisionActivateHandler implements CommandHandler {
  readonly type = "decision.activate";
  readonly capability = "decision.activate";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = DecisionActivatePayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "decision.activate payload is invalid", { issues: payload.error.issues });
    }
    if (command.expectedRevision === undefined) {
      throw new DomainError("validation_error", "decision.activate requires expectedRevision");
    }

    const decisionId = targetDecisionId(command);
    const tx = decisionTransaction(transaction);
    const initial = await tx.lockDecision(command.organizationId, decisionId);
    if (initial === undefined) throw new DomainError("not_found", "Decision was not found", { decisionId });

    const bundle = await tx.lockDecisionActivationBundle(
      command.organizationId,
      decisionId,
      initial.supersedesDecisionId,
    );
    if (bundle === undefined) throw new DomainError("not_found", "Decision was not found", { decisionId });

    const now = this.#now();
    await assertDecisionAuthority(command, bundle.decision, tx, now);

    let superseded: Decision | undefined;
    if (bundle.decision.supersedesDecisionId !== undefined) {
      if (bundle.supersededDecision === undefined) {
        throw new DomainError("invariant_violation", "Replacement Decision lost its supersession target", {
          decisionId,
          supersedesDecisionId: bundle.decision.supersedesDecisionId,
        });
      }
      if (
        bundle.supersededDecision.scope !== bundle.decision.scope ||
        bundle.supersededDecision.authorityCapability !== bundle.decision.authorityCapability
      ) {
        throw new DomainError("invariant_violation", "Supersession crossed Decision scope or authority boundary", {
          decisionId,
          supersedesDecisionId: bundle.supersededDecision.id,
        });
      }
      superseded = supersedeDecision(bundle.supersededDecision, bundle.supersededDecision.revision, now);
    }

    const active = activateDecision(
      bundle.decision,
      payload.data.selectedOptionId,
      payload.data.rationale,
      command.actor,
      now,
      command.expectedRevision,
    );

    await tx.persistDecisionActivation(active, superseded);

    const events: EventDraft[] = [
      {
        type: "decision.activated",
        aggregate: { type: "decision", id: active.id },
        aggregateRevision: active.revision,
        correlationId: command.commandId,
        payload: {
          selectedOptionId: active.selectedOptionId,
          approvedBy: active.approvedBy,
          effectiveAt: active.effectiveAt,
          authorityCapability: active.authorityCapability,
          supersedesDecisionId: active.supersedesDecisionId ?? null,
        },
      },
    ];

    if (superseded !== undefined) {
      events.push({
        type: "decision.superseded",
        aggregate: { type: "decision", id: superseded.id },
        aggregateRevision: superseded.revision,
        correlationId: command.commandId,
        payload: { replacementDecisionId: active.id, effectiveAt: active.effectiveAt },
      });
    }

    return { resultingRevision: active.revision, events };
  }
}

export class DecisionRejectHandler implements CommandHandler {
  readonly type = "decision.reject";
  readonly capability = "decision.reject";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = DecisionRejectPayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "decision.reject payload is invalid", { issues: payload.error.issues });
    }
    if (command.expectedRevision === undefined) {
      throw new DomainError("validation_error", "decision.reject requires expectedRevision");
    }

    const decisionId = targetDecisionId(command);
    const tx = decisionTransaction(transaction);
    const current = await tx.lockDecision(command.organizationId, decisionId);
    if (current === undefined) throw new DomainError("not_found", "Decision was not found", { decisionId });

    const now = this.#now();
    await assertDecisionAuthority(command, current, tx, now);
    const rejected = rejectDecision(current, command.expectedRevision, now);
    await tx.persistDecisionTransition(rejected);

    return {
      resultingRevision: rejected.revision,
      events: [
        {
          type: "decision.rejected",
          aggregate: { type: "decision", id: decisionId },
          aggregateRevision: rejected.revision,
          correlationId: command.commandId,
          payload: { authorityCapability: rejected.authorityCapability, rejectedBy: command.actor },
        },
      ],
    };
  }
}

import type {
  ApprovalRequest,
  ApprovalRequestId,
  CommandEnvelope,
  CommandId,
  CommandResult,
  EventEnvelope,
  EventId,
  OrganizationId,
  ResourceRef,
} from "@aop/protocol";
import type { PolicyEvaluationInput } from "@aop/policy-engine";

export type DedupStatus = "processing" | "approval_pending" | "accepted" | "rejected";

export interface DedupRecord {
  readonly organizationId: OrganizationId;
  readonly idempotencyKey: string;
  readonly commandId: CommandId;
  readonly commandType: string;
  readonly requestDigest: string;
  readonly status: DedupStatus;
  readonly result?: CommandResult;
}

export interface BeginDedupInput {
  readonly organizationId: OrganizationId;
  readonly idempotencyKey: string;
  readonly commandId: CommandId;
  readonly commandType: string;
  readonly actor: CommandEnvelope["actor"];
  readonly requestDigest: string;
}

export interface CommandTransaction {
  findDedup(organizationId: OrganizationId, idempotencyKey: string): Promise<DedupRecord | undefined>;
  beginDedup(input: BeginDedupInput): Promise<void>;
  finishDedup(
    organizationId: OrganizationId,
    idempotencyKey: string,
    status: Exclude<DedupStatus, "processing">,
    result: CommandResult,
  ): Promise<void>;
  resourceBelongsToOrganization(organizationId: OrganizationId, resource: ResourceRef): Promise<boolean>;
  createApprovalRequest(approval: ApprovalRequest): Promise<void>;
  nextOrganizationSequence(organizationId: OrganizationId): Promise<number>;
  appendEvent(event: EventEnvelope): Promise<void>;
  enqueueOutbox(event: EventEnvelope): Promise<void>;
}

export interface CommandStore {
  transaction<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T>;
}

export interface ApprovalSpec {
  readonly policyRule: string;
  readonly requiredAuthority: "human" | "manager" | "role_capability";
  readonly risk: "low" | "medium" | "high" | "critical";
  readonly evidence: readonly ResourceRef[];
  readonly impactSummary: string;
  readonly estimatedCostCredits?: number;
  readonly expiresAt?: string;
}

export interface AuthorizationResolution {
  readonly policyInput: PolicyEvaluationInput;
  readonly approval?: ApprovalSpec;
}

export interface AuthorizationResolver {
  resolve(
    command: CommandEnvelope,
    capability: string,
    transaction: CommandTransaction,
  ): Promise<AuthorizationResolution>;
}

export interface EventDraft {
  readonly type: string;
  readonly aggregate: ResourceRef;
  readonly aggregateRevision: number;
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CommandMutation {
  readonly resultingRevision?: number;
  readonly events: readonly EventDraft[];
}

export interface CommandHandler {
  readonly type: string;
  readonly capability: string;
  readonly requiresExpectedRevision?: boolean;
  execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation>;
}

export interface GatewayIds {
  nextEventId(): EventId;
  nextApprovalRequestId(): ApprovalRequestId;
}

export interface CommandGatewayDependencies {
  readonly store: CommandStore;
  readonly authorization: AuthorizationResolver;
  readonly handlers: readonly CommandHandler[];
  readonly ids: GatewayIds;
  readonly digest: (command: CommandEnvelope) => string;
  readonly now: () => string;
}

import { describe, expect, it } from "vitest";

import { DomainError } from "@aop/domain";
import type {
  ApprovalRequest,
  CommandEnvelope,
  CommandResult,
  EventEnvelope,
  Permission,
  ResourceRef,
} from "@aop/protocol";
import { AOP_PROTOCOL_VERSION } from "@aop/protocol";

import type {
  AuthorizationResolver,
  BeginDedupInput,
  CommandHandler,
  CommandStore,
  CommandTransaction,
  DedupRecord,
  DedupStatus,
  GatewayIds,
} from "./contracts.js";
import { CommandGateway } from "./gateway.js";

const ulid = (value: number) => String(value).padStart(26, "0");
const orgId = `org_${ulid(1)}`;
const taskId = `tsk_${ulid(1)}`;
const otherTaskId = `tsk_${ulid(2)}`;
const agent = { type: "agent", id: `agt_${ulid(1)}` } as const;
const human = { type: "human", id: `usr_${ulid(1)}` } as const;
const now = "2026-08-25T12:30:00+07:00";

interface FakeState {
  dedup: Map<string, DedupRecord>;
  approvals: ApprovalRequest[];
  events: EventEnvelope[];
  outbox: EventEnvelope[];
  sequence: number;
  taskRevision: number;
}

function cloneState(state: FakeState): FakeState {
  return {
    dedup: new Map(state.dedup),
    approvals: [...state.approvals],
    events: [...state.events],
    outbox: [...state.outbox],
    sequence: state.sequence,
    taskRevision: state.taskRevision,
  };
}

const dedupKey = (organizationId: string, idempotencyKey: string) => `${organizationId}:${idempotencyKey}`;

class FakeTransaction implements CommandTransaction {
  readonly state: FakeState;

  constructor(state: FakeState) {
    this.state = state;
  }

  async findDedup(organizationId: typeof orgId, idempotencyKey: string): Promise<DedupRecord | undefined> {
    return this.state.dedup.get(dedupKey(organizationId, idempotencyKey));
  }

  async beginDedup(input: BeginDedupInput): Promise<void> {
    this.state.dedup.set(dedupKey(input.organizationId, input.idempotencyKey), {
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
      commandId: input.commandId,
      commandType: input.commandType,
      requestDigest: input.requestDigest,
      status: "processing",
    });
  }

  async finishDedup(
    organizationId: typeof orgId,
    idempotencyKey: string,
    status: Exclude<DedupStatus, "processing">,
    result: CommandResult,
  ): Promise<void> {
    const key = dedupKey(organizationId, idempotencyKey);
    const current = this.state.dedup.get(key);
    if (current === undefined) throw new Error("Missing dedup record");
    this.state.dedup.set(key, { ...current, status, result });
  }

  async resourceBelongsToOrganization(organizationId: typeof orgId, resource: ResourceRef): Promise<boolean> {
    return organizationId === orgId && resource.type === "task" && resource.id === taskId;
  }

  async createApprovalRequest(approval: ApprovalRequest): Promise<void> {
    this.state.approvals.push(approval);
  }

  async nextOrganizationSequence(organizationId: typeof orgId): Promise<number> {
    if (organizationId !== orgId) throw new Error("Unknown organization");
    this.state.sequence += 1;
    return this.state.sequence;
  }

  async appendEvent(event: EventEnvelope): Promise<void> {
    this.state.events.push(event);
  }

  async enqueueOutbox(event: EventEnvelope): Promise<void> {
    this.state.outbox.push(event);
  }
}

class FakeStore implements CommandStore {
  #state: FakeState = {
    dedup: new Map(),
    approvals: [],
    events: [],
    outbox: [],
    sequence: 0,
    taskRevision: 0,
  };
  #tail: Promise<void> = Promise.resolve();

  get snapshot(): FakeState {
    return cloneState(this.#state);
  }

  transaction<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T> {
    const run = this.#tail.then(async () => {
      const working = cloneState(this.#state);
      const result = await work(new FakeTransaction(working));
      this.#state = working;
      return result;
    });
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function permission(effect: Permission["effect"], capability = "task.update"): Permission {
  return {
    id: `per_${ulid(effect === "allow" ? 1 : effect === "require_approval" ? 2 : 3)}`,
    organizationId: orgId,
    principal: agent,
    capability,
    effect,
    conditions: {},
    grantedBy: human,
    revision: 0,
    createdAt: now,
  };
}

class FakeAuthorization implements AuthorizationResolver {
  readonly effect: Permission["effect"];

  constructor(effect: Permission["effect"] = "allow") {
    this.effect = effect;
  }

  async resolve(command: CommandEnvelope, capability: string) {
    const resourcePart = command.target === undefined ? {} : { resource: command.target };
    return {
      policyInput: {
        organizationId: command.organizationId,
        principal: command.actor,
        capability,
        permissions: [permission(this.effect, capability)],
        resolvedRoles: [],
        now,
        context: {},
        ...resourcePart,
      },
      ...(this.effect === "require_approval"
        ? {
            approval: {
              policyRule: "deploy.protected_environment",
              requiredAuthority: "human" as const,
              risk: "high" as const,
              evidence: [] as ResourceRef[],
              impactSummary: "Protected organizational action requires human authority.",
            },
          }
        : {}),
    };
  }
}

function digest(command: CommandEnvelope): string {
  const source = JSON.stringify({
    type: command.type,
    target: command.target,
    expectedRevision: command.expectedRevision,
    payload: command.payload,
  });
  let hash = 2166136261;
  for (const char of source) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `sha256:${hex.repeat(8)}`;
}

function ids(): GatewayIds {
  let event = 0;
  let approval = 0;
  return {
    nextEventId: () => `evt_${ulid(++event)}`,
    nextApprovalRequestId: () => `apr_${ulid(++approval)}`,
  };
}

function command(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    commandId: `cmd_${ulid(1)}`,
    type: "task.update",
    organizationId: orgId,
    actor: agent,
    target: { type: "task", id: taskId },
    expectedRevision: 0,
    idempotencyKey: "task-update-0001",
    payload: { nextStatus: "running" },
    issuedAt: now,
    ...overrides,
  };
}

function handler(options: { throwAfterMutation?: "domain" | "unexpected" } = {}) {
  let calls = 0;
  const value: CommandHandler = {
    type: "task.update",
    capability: "task.update",
    requiresExpectedRevision: true,
    async execute(input, transaction) {
      calls += 1;
      const fake = transaction as FakeTransaction;
      const expectedRevision = input.expectedRevision;
      if (expectedRevision === undefined) throw new Error("expectedRevision missing");
      if (fake.state.taskRevision !== expectedRevision) {
        throw new DomainError("revision_conflict", "Task revision is stale", {
          currentRevision: fake.state.taskRevision,
          expectedRevision,
        });
      }
      fake.state.taskRevision += 1;
      if (options.throwAfterMutation === "domain") {
        throw new DomainError("invariant_violation", "Injected domain failure after mutation");
      }
      if (options.throwAfterMutation === "unexpected") {
        throw new Error("Injected unexpected failure after mutation");
      }
      return {
        resultingRevision: fake.state.taskRevision,
        events: [
          {
            type: "task.updated",
            aggregate: { type: "task", id: taskId },
            aggregateRevision: fake.state.taskRevision,
            correlationId: "corr_task_update",
            payload: { nextStatus: input.payload.nextStatus },
          },
        ],
      };
    },
  };
  return { value, calls: () => calls };
}

function setup(options: {
  effect?: Permission["effect"];
  throwAfterMutation?: "domain" | "unexpected";
} = {}) {
  const store = new FakeStore();
  const targetHandler = handler({ throwAfterMutation: options.throwAfterMutation });
  const gateway = new CommandGateway({
    store,
    authorization: new FakeAuthorization(options.effect),
    handlers: [targetHandler.value],
    ids: ids(),
    digest,
    now: () => now,
  });
  return { store, gateway, handlerCalls: targetHandler.calls };
}

function errorCode(result: CommandResult): string | undefined {
  return result.ok ? undefined : result.error.code;
}

describe("CommandGateway", () => {
  it("accepts one bounded mutation and atomically records event/outbox/dedup", async () => {
    const { store, gateway, handlerCalls } = setup();
    const result = await gateway.execute(command());

    expect(result.ok).toBe(true);
    expect(handlerCalls()).toBe(1);
    expect(store.snapshot.taskRevision).toBe(1);
    expect(store.snapshot.events).toHaveLength(1);
    expect(store.snapshot.outbox).toHaveLength(1);
    expect([...store.snapshot.dedup.values()][0]?.status).toBe("accepted");
  });

  it("deduplicates an identical retry without executing the handler twice", async () => {
    const { store, gateway, handlerCalls } = setup();
    const input = command();
    const first = await gateway.execute(input);
    const second = await gateway.execute(input);

    expect(second).toEqual(first);
    expect(handlerCalls()).toBe(1);
    expect(store.snapshot.events).toHaveLength(1);
    expect(store.snapshot.taskRevision).toBe(1);
  });

  it("rejects reuse of an idempotency key with a different request", async () => {
    const { store, gateway } = setup();
    await gateway.execute(command());
    const second = await gateway.execute(
      command({ commandId: `cmd_${ulid(2)}`, payload: { nextStatus: "review" } }),
    );

    expect(errorCode(second)).toBe("idempotency_conflict");
    expect(store.snapshot.taskRevision).toBe(1);
    expect(store.snapshot.events).toHaveLength(1);
  });

  it("allows exactly one winner when concurrent commands use the same aggregate revision", async () => {
    const { store, gateway } = setup();
    const [first, second] = await Promise.all([
      gateway.execute(command({ commandId: `cmd_${ulid(3)}`, idempotencyKey: "race-command-0001" })),
      gateway.execute(command({ commandId: `cmd_${ulid(4)}`, idempotencyKey: "race-command-0002" })),
    ]);

    const results = [first, second];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => errorCode(result) === "revision_conflict")).toHaveLength(1);
    expect(store.snapshot.taskRevision).toBe(1);
    expect(store.snapshot.events).toHaveLength(1);
    expect(store.snapshot.dedup.size).toBe(2);
  });

  it("rejects a cross-organization/resource scope mismatch before mutation", async () => {
    const { store, gateway, handlerCalls } = setup();
    const result = await gateway.execute(command({ target: { type: "task", id: otherTaskId } }));

    expect(errorCode(result)).toBe("scope_mismatch");
    expect(handlerCalls()).toBe(0);
    expect(store.snapshot.taskRevision).toBe(0);
    expect(store.snapshot.dedup.size).toBe(0);
  });

  it("enforces policy deny without invoking the mutation handler", async () => {
    const { store, gateway, handlerCalls } = setup({ effect: "deny" });
    const result = await gateway.execute(command());

    expect(errorCode(result)).toBe("forbidden");
    expect(handlerCalls()).toBe(0);
    expect([...store.snapshot.dedup.values()][0]?.status).toBe("rejected");
  });

  it("turns REQUIRE_APPROVAL into durable approval state and an outbox event", async () => {
    const { store, gateway, handlerCalls } = setup({ effect: "require_approval" });
    const result = await gateway.execute(command());

    expect(errorCode(result)).toBe("approval_required");
    expect(handlerCalls()).toBe(0);
    expect(store.snapshot.approvals).toHaveLength(1);
    expect(store.snapshot.events).toHaveLength(1);
    expect(store.snapshot.events[0]?.type).toBe("approval.requested");
    expect(store.snapshot.outbox).toHaveLength(1);
    expect([...store.snapshot.dedup.values()][0]?.status).toBe("approval_pending");
  });

  it("rolls back partial state before recording a deterministic domain rejection", async () => {
    const { store, gateway } = setup({ throwAfterMutation: "domain" });
    const result = await gateway.execute(command());

    expect(errorCode(result)).toBe("invariant_violation");
    expect(store.snapshot.taskRevision).toBe(0);
    expect(store.snapshot.events).toHaveLength(0);
    expect(store.snapshot.outbox).toHaveLength(0);
    expect([...store.snapshot.dedup.values()][0]?.status).toBe("rejected");
  });

  it("rolls back partial state on unexpected failure and leaves the command retryable", async () => {
    const { store, gateway } = setup({ throwAfterMutation: "unexpected" });
    const result = await gateway.execute(command());

    expect(errorCode(result)).toBe("internal_error");
    expect(result.ok ? false : result.error.retryable).toBe(true);
    expect(store.snapshot.taskRevision).toBe(0);
    expect(store.snapshot.events).toHaveLength(0);
    expect(store.snapshot.outbox).toHaveLength(0);
    expect(store.snapshot.dedup.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  CommandGateway,
  type AuthorizationResolver,
  type BeginDedupInput,
  type CommandHandler,
  type CommandStore,
  type CommandTransaction,
  type DedupRecord,
  type DedupStatus,
  type GatewayIds,
} from "@aop/command-bus";
import type {
  ApprovalRequest,
  CommandEnvelope,
  CommandId,
  CommandResult,
  EventEnvelope,
  Permission,
  ResourceRef,
} from "@aop/protocol";

import { GatewayAgentCommandBridge } from "./agent-command-bridge.js";
import type { KernelCommandSubmission } from "./runtime-manager.js";

const ulid = (value: number) => String(value).padStart(26, "0");
const orgId = `org_${ulid(31)}` as const;
const taskId = `tsk_${ulid(31)}` as const;
const agentId = `agt_${ulid(31)}` as const;
const humanId = `usr_${ulid(31)}` as const;
const runId = `run_${ulid(31)}` as const;
const now = "2026-08-25T16:45:00.000Z";

interface State {
  dedup: Map<string, DedupRecord>;
  events: EventEnvelope[];
  outbox: EventEnvelope[];
  sequence: number;
}

function clone(state: State): State {
  return { dedup: new Map(state.dedup), events: [...state.events], outbox: [...state.outbox], sequence: state.sequence };
}

const dedupKey = (organizationId: string, key: string) => `${organizationId}:${key}`;

class Transaction implements CommandTransaction {
  readonly state: State;

  constructor(state: State) {
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
    if (current === undefined) throw new Error("Missing dedup fixture");
    this.state.dedup.set(key, { ...current, status, result });
  }

  async resourceBelongsToOrganization(organizationId: typeof orgId, resource: ResourceRef): Promise<boolean> {
    return organizationId === orgId && resource.type === "task" && resource.id === taskId;
  }

  async createApprovalRequest(_approval: ApprovalRequest): Promise<void> {}

  async nextOrganizationSequence(organizationId: typeof orgId): Promise<number> {
    if (organizationId !== orgId) throw new Error("Unknown Organization");
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

class Store implements CommandStore {
  state: State = { dedup: new Map(), events: [], outbox: [], sequence: 0 };

  async transaction<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T> {
    const working = clone(this.state);
    const result = await work(new Transaction(working));
    this.state = working;
    return result;
  }
}

function permission(effect: Permission["effect"]): Permission {
  return {
    id: `per_${ulid(effect === "allow" ? 31 : 32)}`,
    organizationId: orgId,
    principal: { type: "agent", id: agentId },
    capability: "task.update",
    effect,
    conditions: {},
    grantedBy: { type: "human", id: humanId },
    revision: 0,
    createdAt: now,
  };
}

class Authorization implements AuthorizationResolver {
  readonly effect: Permission["effect"];

  constructor(effect: Permission["effect"]) {
    this.effect = effect;
  }

  async resolve(command: CommandEnvelope, capability: string) {
    return {
      policyInput: {
        organizationId: command.organizationId,
        principal: command.actor,
        capability,
        permissions: [permission(this.effect)],
        resolvedRoles: [],
        now,
        context: {},
        ...(command.target === undefined ? {} : { resource: command.target }),
      },
    };
  }
}

function ids(): GatewayIds {
  let event = 0;
  return {
    nextEventId: () => `evt_${ulid(40 + ++event)}`,
    nextApprovalRequestId: () => `apr_${ulid(41)}`,
  };
}

function digest(command: CommandEnvelope): string {
  const stable = JSON.stringify({
    type: command.type,
    target: command.target,
    expectedRevision: command.expectedRevision,
    payload: command.payload,
  });
  let hash = 2166136261;
  for (const char of stable) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `sha256:${(hash >>> 0).toString(16).padStart(8, "0").repeat(8)}`;
}

function handler(counter: { calls: number }): CommandHandler {
  return {
    type: "task.update",
    capability: "task.update",
    requiresExpectedRevision: true,
    async execute(command) {
      counter.calls += 1;
      return {
        resultingRevision: (command.expectedRevision ?? 0) + 1,
        events: [
          {
            type: "task.updated",
            aggregate: { type: "task", id: taskId },
            aggregateRevision: (command.expectedRevision ?? 0) + 1,
            correlationId: command.commandId,
            payload: command.payload,
          },
        ],
      };
    },
  };
}

class CommandIds {
  value = 50;

  nextCommandId(): CommandId {
    this.value += 1;
    return `cmd_${ulid(this.value)}`;
  }
}

function submission(): KernelCommandSubmission {
  return {
    organizationId: orgId,
    runId,
    agentId,
    proposalIndex: 0,
    proposal: {
      type: "task.update",
      target: { type: "task", id: taskId },
      expectedRevision: 3,
      payload: { nextStatus: "running" },
    },
  };
}

function setup(effect: Permission["effect"]) {
  const store = new Store();
  const counter = { calls: 0 };
  const gateway = new CommandGateway({
    store,
    authorization: new Authorization(effect),
    handlers: [handler(counter)],
    ids: ids(),
    digest,
    now: () => now,
  });
  return { store, counter, bridge: new GatewayAgentCommandBridge(gateway, new CommandIds(), () => now) };
}

describe("Gateway Agent Command Bridge + real CommandGateway", () => {
  it("routes an allowed runtime proposal through policy and Event/Outbox commit", async () => {
    const { bridge, store, counter } = setup("allow");

    const result = await bridge.submit(submission());

    expect(result.ok).toBe(true);
    expect(counter.calls).toBe(1);
    expect(store.state.events).toHaveLength(1);
    expect(store.state.outbox).toHaveLength(1);
    expect(store.state.events[0]?.actor).toEqual({ type: "agent", id: agentId });
  });

  it("applies CommandGateway policy denial before the handler can mutate", async () => {
    const { bridge, store, counter } = setup("deny");

    const result = await bridge.submit(submission());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected denied command");
    expect(result.error.code).toBe("forbidden");
    expect(counter.calls).toBe(0);
    expect(store.state.events).toEqual([]);
  });

  it("replays the first accepted result through CommandGateway idempotency without a second mutation", async () => {
    const { bridge, store, counter } = setup("allow");

    const first = await bridge.submit(submission());
    const second = await bridge.submit(submission());

    expect(second).toEqual(first);
    expect(counter.calls).toBe(1);
    expect(store.state.events).toHaveLength(1);
    expect(store.state.dedup.size).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import { CommandEnvelopeSchema, type CommandResult } from "@aop/protocol";

import { DeterministicScheduler, type SchedulerCandidate, type SchedulerCandidateStore } from "./scheduler.js";

const ulid = (value: number) => String(value).padStart(26, "0");
const now = "2026-08-25T14:45:00.000+07:00";

function candidate(value: number): SchedulerCandidate {
  return {
    organizationId: `org_${ulid(1)}`,
    taskId: `tsk_${ulid(value)}`,
    taskRevision: 4,
    taskUpdatedAt: "2026-08-25T07:40:00.000Z",
    priority: value === 1 ? "critical" : "high",
    agentId: `agt_${ulid(value)}`,
    runtimeType: "runtime.test",
    attempt: 2,
  };
}

class Store implements SchedulerCandidateStore {
  readonly candidates: readonly SchedulerCandidate[];

  constructor(candidates: readonly SchedulerCandidate[]) {
    this.candidates = candidates;
  }

  async listCandidates(): Promise<readonly SchedulerCandidate[]> {
    return this.candidates;
  }
}

const accepted = (commandId: string): CommandResult => ({
  ok: true,
  commandId: commandId as CommandResult["commandId"],
  resultingRevision: 5,
  emittedEventIds: [`evt_${ulid(1)}`],
});

const rejected = (commandId: string, code: "revision_conflict" | "forbidden"): CommandResult => ({
  ok: false,
  commandId: commandId as CommandResult["commandId"],
  error: { code, message: code, retryable: code === "revision_conflict", details: {} },
});

describe("DeterministicScheduler", () => {
  it("builds the same claim identity for the same task revision and candidate", async () => {
    const seen: unknown[] = [];
    const executor = {
      async execute(input: unknown) {
        seen.push(input);
        const parsed = CommandEnvelopeSchema.parse(input);
        return accepted(parsed.commandId);
      },
    };
    const scheduler = new DeterministicScheduler({ store: new Store([candidate(1)]), executor, now: () => now });

    await scheduler.runOnce();
    await scheduler.runOnce();

    const first = CommandEnvelopeSchema.parse(seen[0]);
    const second = CommandEnvelopeSchema.parse(seen[1]);
    expect(second.commandId).toBe(first.commandId);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.payload).toEqual(first.payload);
  });

  it("continues after a stale candidate and claims the next deterministic candidate", async () => {
    let calls = 0;
    const executor = {
      async execute(input: unknown) {
        calls += 1;
        const parsed = CommandEnvelopeSchema.parse(input);
        return calls === 1 ? rejected(parsed.commandId, "revision_conflict") : accepted(parsed.commandId);
      },
    };
    const scheduler = new DeterministicScheduler({
      store: new Store([candidate(1), candidate(2)]),
      executor,
      now: () => now,
    });

    const result = await scheduler.runOnce();
    expect(result.attempted).toBe(2);
    expect(result.claimed?.taskId).toBe(candidate(2).taskId);
    expect(result.commandResult?.ok).toBe(true);
  });

  it("stops on policy denial rather than probing additional agents/tasks", async () => {
    let calls = 0;
    const executor = {
      async execute(input: unknown) {
        calls += 1;
        const parsed = CommandEnvelopeSchema.parse(input);
        return rejected(parsed.commandId, "forbidden");
      },
    };
    const scheduler = new DeterministicScheduler({
      store: new Store([candidate(1), candidate(2)]),
      executor,
      now: () => now,
    });

    const result = await scheduler.runOnce();
    expect(calls).toBe(1);
    expect(result.claimed).toBeUndefined();
    expect(result.commandResult).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});

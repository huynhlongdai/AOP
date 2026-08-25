import { describe, expect, it } from "vitest";

import type { EventEnvelope, EventId } from "@aop/protocol";

import type { EventPublisher } from "./publisher.js";
import type { OutboxDelivery, OutboxStore } from "./outbox-store.js";
import { OutboxWorker, retryDelayMs } from "./worker.js";

const ULID = "00000000000000000000000000";
const event: EventEnvelope = {
  schemaVersion: 1,
  protocolVersion: "0.1.0",
  eventId: `evt_${ULID}`,
  type: "task.ready",
  organizationId: `org_${ULID}`,
  organizationSequence: 7,
  aggregate: { type: "task", id: `tsk_${ULID}` },
  aggregateRevision: 1,
  actor: { type: "system", id: "scheduler" },
  correlationId: "outbox-worker-test",
  payload: {},
  occurredAt: "2026-08-25T13:00:00.000Z",
};

class FakeStore implements OutboxStore {
  readonly deliveries: OutboxDelivery[];
  readonly published: Array<{ eventId: EventId; workerId: string; at: string }> = [];
  readonly failed: Array<{ eventId: EventId; workerId: string; error: string; retryAt: string }> = [];

  constructor(deliveries: OutboxDelivery[]) {
    this.deliveries = deliveries;
  }

  async claimBatch(): Promise<readonly OutboxDelivery[]> {
    return this.deliveries;
  }

  async markPublished(eventId: EventId, workerId: string, publishedAt: string): Promise<void> {
    this.published.push({ eventId, workerId, at: publishedAt });
  }

  async markFailed(eventId: EventId, workerId: string, error: string, retryAt: string): Promise<void> {
    this.failed.push({ eventId, workerId, error, retryAt });
  }
}

class FakePublisher implements EventPublisher {
  readonly seen: EventEnvelope[] = [];
  readonly failure?: Error;

  constructor(failure?: Error) {
    this.failure = failure;
  }

  async publish(item: EventEnvelope): Promise<void> {
    this.seen.push(item);
    if (this.failure !== undefined) throw this.failure;
  }
}

describe("OutboxWorker", () => {
  it("publishes and acknowledges a claimed event", async () => {
    const store = new FakeStore([{ event, attemptCount: 1 }]);
    const publisher = new FakePublisher();
    const worker = new OutboxWorker({
      store,
      publisher,
      workerId: "worker-a",
      now: () => new Date("2026-08-25T13:00:01.000Z"),
    });

    await expect(worker.runOnce()).resolves.toEqual({ claimed: 1, published: 1, failed: 0 });
    expect(publisher.seen).toEqual([event]);
    expect(store.published).toEqual([
      { eventId: event.eventId, workerId: "worker-a", at: "2026-08-25T13:00:01.000Z" },
    ]);
    expect(store.failed).toEqual([]);
  });

  it("marks publisher failures for deterministic retry", async () => {
    const store = new FakeStore([{ event, attemptCount: 3 }]);
    const publisher = new FakePublisher(new Error("transport unavailable"));
    const worker = new OutboxWorker({
      store,
      publisher,
      workerId: "worker-a",
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
      now: () => new Date("2026-08-25T13:00:00.000Z"),
    });

    await expect(worker.runOnce()).resolves.toEqual({ claimed: 1, published: 0, failed: 1 });
    expect(store.published).toEqual([]);
    expect(store.failed).toEqual([
      {
        eventId: event.eventId,
        workerId: "worker-a",
        error: "Error: transport unavailable",
        retryAt: "2026-08-25T13:00:04.000Z",
      },
    ]);
  });

  it("caps exponential retry delay", () => {
    expect(retryDelayMs(1, 1_000, 10_000)).toBe(1_000);
    expect(retryDelayMs(2, 1_000, 10_000)).toBe(2_000);
    expect(retryDelayMs(8, 1_000, 10_000)).toBe(10_000);
  });
});

import type { EventId } from "@aop/protocol";

import type { EventPublisher } from "./publisher.js";
import type { OutboxDelivery, OutboxStore } from "./outbox-store.js";

export interface OutboxWorkerOptions {
  readonly store: OutboxStore;
  readonly publisher: EventPublisher;
  readonly workerId: string;
  readonly batchSize?: number;
  readonly staleAfterMs?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
  readonly now?: () => Date;
}

export interface OutboxRunResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
}

export class OutboxRunError extends AggregateError {
  readonly result: OutboxRunResult;

  constructor(errors: readonly unknown[], result: OutboxRunResult) {
    super(errors, "One or more outbox deliveries could not be acknowledged");
    this.name = "OutboxRunError";
    this.result = result;
  }
}

export function retryDelayMs(attemptCount: number, baseMs = 1_000, maxMs = 60_000): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) throw new TypeError("attemptCount must be positive");
  if (!Number.isSafeInteger(baseMs) || baseMs < 1) throw new TypeError("baseMs must be positive");
  if (!Number.isSafeInteger(maxMs) || maxMs < baseMs) throw new TypeError("maxMs must be >= baseMs");
  const exponent = Math.min(30, attemptCount - 1);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

function failureMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 4_000);
  return `UnknownError: ${String(error)}`.slice(0, 4_000);
}

interface DeliveryOutcome {
  readonly eventId: EventId;
  readonly status: "published" | "failed";
}

export class OutboxWorker {
  readonly #store: OutboxStore;
  readonly #publisher: EventPublisher;
  readonly #workerId: string;
  readonly #batchSize: number;
  readonly #staleAfterMs: number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #now: () => Date;

  constructor(options: OutboxWorkerOptions) {
    this.#store = options.store;
    this.#publisher = options.publisher;
    this.#workerId = options.workerId;
    this.#batchSize = options.batchSize ?? 50;
    this.#staleAfterMs = options.staleAfterMs ?? 30_000;
    this.#retryBaseMs = options.retryBaseMs ?? 1_000;
    this.#retryMaxMs = options.retryMaxMs ?? 60_000;
    this.#now = options.now ?? (() => new Date());
  }

  async #deliver(delivery: OutboxDelivery): Promise<DeliveryOutcome> {
    try {
      await this.#publisher.publish(delivery.event);
    } catch (error) {
      const delay = retryDelayMs(delivery.attemptCount, this.#retryBaseMs, this.#retryMaxMs);
      const retryAt = new Date(this.#now().valueOf() + delay).toISOString();
      await this.#store.markFailed(
        delivery.event.eventId,
        this.#workerId,
        failureMessage(error),
        retryAt,
      );
      return { eventId: delivery.event.eventId, status: "failed" };
    }

    await this.#store.markPublished(delivery.event.eventId, this.#workerId, this.#now().toISOString());
    return { eventId: delivery.event.eventId, status: "published" };
  }

  async runOnce(): Promise<OutboxRunResult> {
    const deliveries = await this.#store.claimBatch(this.#workerId, this.#batchSize, this.#staleAfterMs);
    if (deliveries.length === 0) return { claimed: 0, published: 0, failed: 0 };

    const settled = await Promise.allSettled(deliveries.map(async (delivery) => this.#deliver(delivery)));
    let published = 0;
    let failed = 0;
    const errors: unknown[] = [];

    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        errors.push(outcome.reason);
        continue;
      }
      if (outcome.value.status === "published") published += 1;
      else failed += 1;
    }

    const result = { claimed: deliveries.length, published, failed };
    if (errors.length > 0) throw new OutboxRunError(errors, result);
    return result;
  }
}

export interface OutboxLoopOptions {
  readonly worker: OutboxWorker;
  readonly signal: AbortSignal;
  readonly idleDelayMs?: number;
  readonly onRunError?: (error: unknown) => void;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function runOutboxLoop(options: OutboxLoopOptions): Promise<void> {
  const idleDelayMs = options.idleDelayMs ?? 500;
  while (!options.signal.aborted) {
    try {
      const result = await options.worker.runOnce();
      if (result.claimed === 0) await delay(idleDelayMs, options.signal);
    } catch (error) {
      options.onRunError?.(error);
      await delay(idleDelayMs, options.signal);
    }
  }
}

import type { Pool } from "pg";

import type { EventEnvelope } from "@aop/protocol";

export interface EventPublisher {
  publish(event: EventEnvelope): Promise<void>;
}

export interface EventNotification {
  readonly eventId: EventEnvelope["eventId"];
  readonly organizationId: EventEnvelope["organizationId"];
  readonly organizationSequence: number;
  readonly type: string;
}

export class PostgresNotifyPublisher implements EventPublisher {
  readonly #pool: Pool;
  readonly #channel: string;

  constructor(pool: Pool, channel = "aop_events") {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(channel)) {
      throw new TypeError("PostgreSQL notification channel is invalid");
    }
    this.#pool = pool;
    this.#channel = channel;
  }

  async publish(event: EventEnvelope): Promise<void> {
    const notification: EventNotification = {
      eventId: event.eventId,
      organizationId: event.organizationId,
      organizationSequence: event.organizationSequence,
      type: event.type,
    };
    await this.#pool.query("SELECT pg_notify($1, $2)", [this.#channel, JSON.stringify(notification)]);
  }
}

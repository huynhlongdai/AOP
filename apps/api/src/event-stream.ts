import type { ServerResponse } from "node:http";

import type { OrganizationQueryStore } from "@aop/database";
import type { EventEnvelope, OrganizationId } from "@aop/protocol";

export function parseEventSequenceCursor(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("Event cursor must be a non-negative integer");
  return parsed;
}

export function formatSseEvent(event: EventEnvelope): string {
  return `id: ${event.organizationSequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function waitForNextPoll(response: ServerResponse, milliseconds: number): Promise<void> {
  if (response.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      response.off("close", done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    response.once("close", done);
  });
}

export interface OrganizationEventStreamOptions {
  readonly store: OrganizationQueryStore;
  readonly organizationId: OrganizationId;
  readonly response: ServerResponse;
  readonly afterSequence: number;
  readonly pollIntervalMs?: number;
  readonly pageSize?: number;
}

export async function streamOrganizationEvents(options: OrganizationEventStreamOptions): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const pageSize = options.pageSize ?? 100;
  let cursor = options.afterSequence;

  options.response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  options.response.write(`: connected after=${cursor}\n\n`);

  while (!options.response.destroyed) {
    const page = await options.store.listEvents(options.organizationId, cursor, pageSize);
    for (const event of page.events) options.response.write(formatSseEvent(event));
    cursor = page.nextAfterSequence;

    if (page.hasMore) continue;
    options.response.write(`: heartbeat cursor=${cursor}\n\n`);
    await waitForNextPoll(options.response, pollIntervalMs);
  }
}

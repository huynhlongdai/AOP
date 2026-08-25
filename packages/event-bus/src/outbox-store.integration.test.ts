import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type { EventId, OrganizationId } from "@aop/protocol";

import { OutboxOwnershipError, PostgresOutboxStore } from "./outbox-store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl === undefined ? describe.skip : describe;
const pool = databaseUrl === undefined ? undefined : new Pool({ connectionString: databaseUrl });

const organizationId = "org_00000000000000000000000021" as OrganizationId;
const ownerId = "usr_00000000000000000000000021";
const eventIds = [
  "evt_00000000000000000000000021",
  "evt_00000000000000000000000022",
  "evt_00000000000000000000000023",
] as const satisfies readonly EventId[];

async function seed(): Promise<void> {
  if (pool === undefined) return;
  await pool.query("DELETE FROM aop.organizations WHERE id = $1", [organizationId]);
  await pool.query(
    `INSERT INTO aop.organizations (
       id, name, type, status, mission, owner_type, owner_id,
       autonomy_level, revision, created_at, updated_at
     ) VALUES ($1, 'Outbox Test Org', 'company', 'active', 'Validate durable delivery',
       'human', $2, 'human_managed', 0, now(), now())`,
    [organizationId, ownerId],
  );

  for (const [index, eventId] of eventIds.entries()) {
    await pool.query(
      `INSERT INTO aop.events (
         id, organization_id, organization_sequence, schema_version, protocol_version,
         type, aggregate_type, aggregate_id, aggregate_revision,
         actor_type, actor_id, causation_id, correlation_id, payload, occurred_at
       ) VALUES ($1, $2, $3, 1, '0.1.0', 'organization.updated', 'organization', $2, $3,
         'human', $4, NULL, 'outbox-integration', '{}'::jsonb, now())`,
      [eventId, organizationId, index + 1, ownerId],
    );
    await pool.query(
      `INSERT INTO aop.outbox_events (event_id, organization_id, status, attempt_count, available_at, created_at)
       VALUES ($1, $2, 'pending', 0, now(), now())`,
      [eventId, organizationId],
    );
  }
}

describeWithDatabase("PostgresOutboxStore", () => {
  beforeEach(seed);

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query("DELETE FROM aop.organizations WHERE id = $1", [organizationId]);
    await pool.end();
  });

  it("uses SKIP LOCKED so concurrent workers never claim the same event", async () => {
    if (pool === undefined) throw new Error("DATABASE_URL is required");
    const store = new PostgresOutboxStore(pool);
    const [first, second] = await Promise.all([
      store.claimBatch("worker-a", 2, 30_000),
      store.claimBatch("worker-b", 2, 30_000),
    ]);

    const claimedIds = [...first, ...second].map((delivery) => delivery.event.eventId);
    expect(claimedIds).toHaveLength(3);
    expect(new Set(claimedIds).size).toBe(3);
    expect([...first, ...second].every((delivery) => delivery.attemptCount === 1)).toBe(true);
  });

  it("rejects acknowledgement from a worker that does not own the claim", async () => {
    if (pool === undefined) throw new Error("DATABASE_URL is required");
    const store = new PostgresOutboxStore(pool);
    const delivery = (await store.claimBatch("worker-a", 1, 30_000))[0];
    if (delivery === undefined) throw new Error("expected one delivery");

    await expect(
      store.markPublished(delivery.event.eventId, "worker-b", new Date().toISOString()),
    ).rejects.toBeInstanceOf(OutboxOwnershipError);

    await store.markPublished(delivery.event.eventId, "worker-a", new Date().toISOString());
    const row = await pool.query(
      "SELECT status, locked_at, locked_by, published_at FROM aop.outbox_events WHERE event_id = $1",
      [delivery.event.eventId],
    );
    expect(row.rows[0]).toMatchObject({ status: "published", locked_at: null, locked_by: null });
    expect(row.rows[0]?.published_at).toBeInstanceOf(Date);
  });

  it("reclaims a stale processing row after worker loss", async () => {
    if (pool === undefined) throw new Error("DATABASE_URL is required");
    const store = new PostgresOutboxStore(pool);
    const delivery = (await store.claimBatch("dead-worker", 1, 30_000))[0];
    if (delivery === undefined) throw new Error("expected one delivery");

    await pool.query(
      "UPDATE aop.outbox_events SET locked_at = now() - interval '2 minutes' WHERE event_id = $1",
      [delivery.event.eventId],
    );

    const reclaimed = await store.claimBatch("replacement-worker", 1, 30_000);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.event.eventId).toBe(delivery.event.eventId);
    expect(reclaimed[0]?.attemptCount).toBe(2);
  });

  it("does not reclaim a failed delivery before retryAt", async () => {
    if (pool === undefined) throw new Error("DATABASE_URL is required");
    const store = new PostgresOutboxStore(pool);
    const delivery = (await store.claimBatch("worker-a", 1, 30_000))[0];
    if (delivery === undefined) throw new Error("expected one delivery");

    const retryAt = new Date(Date.now() + 60_000).toISOString();
    await store.markFailed(delivery.event.eventId, "worker-a", "transport failure", retryAt);

    const immediate = await store.claimBatch("worker-b", 1, 30_000);
    expect(immediate.map((item) => item.event.eventId)).not.toContain(delivery.event.eventId);

    await pool.query("UPDATE aop.outbox_events SET available_at = now() - interval '1 second' WHERE event_id = $1", [
      delivery.event.eventId,
    ]);
    const retried = await store.claimBatch("worker-b", 3, 30_000);
    const same = retried.find((item) => item.event.eventId === delivery.event.eventId);
    expect(same?.attemptCount).toBe(2);
  });
});

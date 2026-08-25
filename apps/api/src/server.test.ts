import { afterEach, describe, expect, it } from "vitest";

import type { OrganizationQueryStore } from "@aop/database";
import type {
  EventEnvelope,
  EventPage,
  OrganizationId,
  OrganizationSnapshot,
} from "@aop/protocol";

import { buildApiServer } from "./server.js";

const ULID = "00000000000000000000000000";
const organizationId = `org_${ULID}` as OrganizationId;
const taskId = `tsk_${ULID}` as const;

const snapshot: OrganizationSnapshot = {
  organization: {
    id: organizationId,
    name: "AOP Test Org",
    type: "company",
    status: "active",
    owner: { type: "human", id: `usr_${ULID}` },
    autonomyLevel: "human_managed",
    revision: 1,
    createdAt: "2026-08-25T13:00:00.000Z",
    updatedAt: "2026-08-25T13:01:00.000Z",
  },
  agents: [],
  memberships: [],
  roles: [],
  roleAssignments: [],
  goals: [],
  tasks: [],
  pendingApprovals: [],
  latestEventSequence: 3,
  generatedAt: "2026-08-25T13:02:00.000Z",
};

const event: EventEnvelope = {
  schemaVersion: 1,
  protocolVersion: "0.1.0",
  eventId: `evt_${ULID}`,
  type: "task.updated",
  organizationId,
  organizationSequence: 4,
  aggregate: { type: "task", id: taskId },
  aggregateRevision: 2,
  actor: { type: "human", id: `usr_${ULID}` },
  correlationId: "api-test",
  payload: { state: "running" },
  occurredAt: "2026-08-25T13:03:00.000Z",
};

function eventPage(afterSequence: number): EventPage {
  const events = afterSequence < event.organizationSequence ? [event] : [];
  return {
    organizationId,
    afterSequence,
    events,
    nextAfterSequence: events.at(-1)?.organizationSequence ?? afterSequence,
    hasMore: false,
  };
}

function createStore(): OrganizationQueryStore {
  return {
    async getOrganizationSnapshot(id) {
      return id === organizationId ? snapshot : undefined;
    },
    async getTaskDetail() {
      return undefined;
    },
    async getArtifactVersions() {
      return undefined;
    },
    async listEvents(_id, afterSequence = 0) {
      return eventPage(afterSequence);
    },
    async listDecisions() {
      return [];
    },
    async listApprovals() {
      return [];
    },
    async listGoals() {
      return [];
    },
    async listTasks() {
      return [];
    },
  };
}

const servers: ReturnType<typeof buildApiServer>[] = [];

function createServer() {
  const server = buildApiServer({ queryStore: createStore(), eventPollIntervalMs: 5 });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe("observer API", () => {
  it("returns one authoritative organization snapshot", async () => {
    const response = await createServer().inject({
      method: "GET",
      url: `/organizations/${organizationId}/snapshot`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      organization: { id: organizationId, name: "AOP Test Org" },
      latestEventSequence: 3,
    });
  });

  it("rejects malformed organization ids at the API boundary", async () => {
    const response = await createServer().inject({
      method: "GET",
      url: "/organizations/not-an-org/snapshot",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "validation_error" });
  });

  it("returns 404 for a missing task instead of leaking an empty detail object", async () => {
    const response = await createServer().inject({
      method: "GET",
      url: `/organizations/${organizationId}/tasks/${taskId}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });

  it("resumes ordered events strictly after the supplied sequence", async () => {
    const response = await createServer().inject({
      method: "GET",
      url: `/organizations/${organizationId}/events?after=3&limit=10`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      afterSequence: 3,
      nextAfterSequence: 4,
      hasMore: false,
      events: [{ organizationSequence: 4, type: "task.updated" }],
    });
  });

  it("rejects invalid event page limits", async () => {
    const response = await createServer().inject({
      method: "GET",
      url: `/organizations/${organizationId}/events?limit=201`,
    });
    expect(response.statusCode).toBe(400);
  });
});

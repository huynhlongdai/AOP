import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

import type { OrganizationQueryStore } from "@aop/database";
import {
  ApprovalStatusSchema,
  ArtifactIdSchema,
  OrganizationIdSchema,
  TaskIdSchema,
} from "@aop/protocol";

import { parseEventSequenceCursor, streamOrganizationEvents } from "./event-stream.js";

interface OrganizationParams {
  organizationId: string;
}

interface TaskParams extends OrganizationParams {
  taskId: string;
}

interface ArtifactParams extends OrganizationParams {
  artifactId: string;
}

interface EventQuery {
  after?: string;
  limit?: string;
}

interface ApprovalQuery {
  status?: string;
}

export interface ApiServerOptions {
  readonly queryStore: OrganizationQueryStore;
  readonly logger?: boolean;
  readonly eventPollIntervalMs?: number;
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: "validation_error", message });
}

function notFound(reply: FastifyReply, resource: string) {
  return reply.code(404).send({ error: "not_found", message: `${resource} was not found` });
}

function parseOrganizationId(value: string, reply: FastifyReply) {
  const parsed = OrganizationIdSchema.safeParse(value);
  if (!parsed.success) {
    badRequest(reply, "organizationId is invalid");
    return undefined;
  }
  return parsed.data;
}

export function buildApiServer(options: ApiServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/healthz", async () => ({ ok: true }));

  app.get<{ Params: OrganizationParams }>("/organizations/:organizationId/snapshot", async (request, reply) => {
    const organizationId = parseOrganizationId(request.params.organizationId, reply);
    if (organizationId === undefined) return;
    const snapshot = await options.queryStore.getOrganizationSnapshot(organizationId);
    if (snapshot === undefined) return notFound(reply, "organization");
    return snapshot;
  });

  app.get<{ Params: OrganizationParams }>("/organizations/:organizationId/goals", async (request, reply) => {
    const organizationId = parseOrganizationId(request.params.organizationId, reply);
    if (organizationId === undefined) return;
    return options.queryStore.listGoals(organizationId);
  });

  app.get<{ Params: OrganizationParams }>("/organizations/:organizationId/tasks", async (request, reply) => {
    const organizationId = parseOrganizationId(request.params.organizationId, reply);
    if (organizationId === undefined) return;
    return options.queryStore.listTasks(organizationId);
  });

  app.get<{ Params: TaskParams }>("/organizations/:organizationId/tasks/:taskId", async (request, reply) => {
    const organizationId = parseOrganizationId(request.params.organizationId, reply);
    if (organizationId === undefined) return;
    const taskId = TaskIdSchema.safeParse(request.params.taskId);
    if (!taskId.success) return badRequest(reply, "taskId is invalid");
    const detail = await options.queryStore.getTaskDetail(organizationId, taskId.data);
    if (detail === undefined) return notFound(reply, "task");
    return detail;
  });

  app.get<{ Params: ArtifactParams }>(
    "/organizations/:organizationId/artifacts/:artifactId",
    async (request, reply) => {
      const organizationId = parseOrganizationId(request.params.organizationId, reply);
      if (organizationId === undefined) return;
      const artifactId = ArtifactIdSchema.safeParse(request.params.artifactId);
      if (!artifactId.success) return badRequest(reply, "artifactId is invalid");
      const artifact = await options.queryStore.getArtifactVersions(organizationId, artifactId.data);
      if (artifact === undefined) return notFound(reply, "artifact");
      return artifact;
    },
  );

  app.get<{ Params: OrganizationParams }>("/organizations/:organizationId/decisions", async (request, reply) => {
    const organizationId = parseOrganizationId(request.params.organizationId, reply);
    if (organizationId === undefined) return;
    return options.queryStore.listDecisions(organizationId);
  });

  app.get<{ Params: OrganizationParams; Querystring: ApprovalQuery }>(
    "/organizations/:organizationId/approvals",
    async (request, reply) => {
      const organizationId = parseOrganizationId(request.params.organizationId, reply);
      if (organizationId === undefined) return;
      if (request.query.status === undefined) return options.queryStore.listApprovals(organizationId);
      const status = ApprovalStatusSchema.safeParse(request.query.status);
      if (!status.success) return badRequest(reply, "approval status is invalid");
      return options.queryStore.listApprovals(organizationId, status.data);
    },
  );

  app.get<{ Params: OrganizationParams; Querystring: EventQuery }>(
    "/organizations/:organizationId/events",
    async (request, reply) => {
      const organizationId = parseOrganizationId(request.params.organizationId, reply);
      if (organizationId === undefined) return;
      try {
        const after = parseEventSequenceCursor(request.query.after);
        const limit = request.query.limit === undefined ? 100 : parseEventSequenceCursor(request.query.limit);
        if (limit < 1 || limit > 200) return badRequest(reply, "limit must be between 1 and 200");
        return options.queryStore.listEvents(organizationId, after, limit);
      } catch {
        return badRequest(reply, "event cursor or limit is invalid");
      }
    },
  );

  app.get<{ Params: OrganizationParams; Querystring: EventQuery }>(
    "/organizations/:organizationId/events/stream",
    async (request, reply) => {
      const organizationId = parseOrganizationId(request.params.organizationId, reply);
      if (organizationId === undefined) return;

      const lastEventIdHeader = request.headers["last-event-id"];
      const lastEventId = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader;
      let afterSequence: number;
      try {
        afterSequence = parseEventSequenceCursor(
          request.query.after === undefined ? lastEventId : request.query.after,
        );
      } catch {
        return badRequest(reply, "event cursor is invalid");
      }

      reply.hijack();
      try {
        await streamOrganizationEvents({
          store: options.queryStore,
          organizationId,
          response: reply.raw,
          afterSequence,
          ...(options.eventPollIntervalMs === undefined
            ? {}
            : { pollIntervalMs: options.eventPollIntervalMs }),
        });
      } catch (error) {
        if (!reply.raw.destroyed) {
          reply.raw.write(
            `event: stream.error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : "stream failed" })}\n\n`,
          );
          reply.raw.end();
        }
      }
    },
  );

  return app;
}

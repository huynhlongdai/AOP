import type { Pool, PoolClient, QueryResult } from "pg";

import type {
  AuthorizationResolution,
  AuthorizationResolver,
  BeginDedupInput,
  CommandStore,
  CommandTransaction,
  DedupRecord,
  DedupStatus,
  LeaseExecutionBundle,
  LeaseRecoveryTransaction,
  TaskClaimAgentProfile,
  TaskClaimTransaction,
} from "@aop/command-bus";
import { DomainError } from "@aop/domain";
import {
  ApprovalRequestSchema,
  CommandResultSchema,
  EventEnvelopeSchema,
  PermissionSchema,
  RoleSchema,
  type AgentId,
  type ApprovalRequest,
  type CommandEnvelope,
  type CommandResult,
  type EventEnvelope,
  type Lease,
  type LeaseId,
  type OrganizationId,
  type Permission,
  type Principal,
  type ResourceRef,
  type Role,
  type Task,
  type TaskId,
  type TaskRun,
} from "@aop/protocol";

import { mapLease, mapRole, mapTask, mapTaskRun, type QueryRow } from "./query-mappers.js";

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function json(value: unknown): unknown {
  if (typeof value === "string") return JSON.parse(value) as unknown;
  return value;
}

function optionalResource(type: unknown, id: unknown): ResourceRef | undefined {
  if (type === null || type === undefined || id === null || id === undefined) return undefined;
  return { type: String(type), id: String(id) } as ResourceRef;
}

function mapPermission(row: QueryRow): Permission {
  const resource = optionalResource(row.resource_type, row.resource_id);
  const expiresAt = row.expires_at === null || row.expires_at === undefined ? undefined : timestamp(row.expires_at);
  return PermissionSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    principal: { type: row.principal_type, id: row.principal_id },
    capability: row.capability,
    effect: row.effect,
    conditions: json(row.conditions),
    grantedBy: { type: row.granted_by_type, id: row.granted_by_id },
    revision: Number(row.revision),
    createdAt: timestamp(row.created_at),
    ...(resource === undefined ? {} : { resource }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });
}

function resultRows(result: QueryResult<Record<string, unknown>>): QueryRow[] {
  return result.rows;
}

async function rows(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow[]> {
  return resultRows(await client.query<Record<string, unknown>>(text, [...values]));
}

async function one(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow | undefined> {
  return (await rows(client, text, values))[0];
}

function dedupFromRow(row: QueryRow): DedupRecord {
  const result = row.result === null || row.result === undefined ? undefined : CommandResultSchema.parse(json(row.result));
  return {
    organizationId: String(row.organization_id) as DedupRecord["organizationId"],
    idempotencyKey: String(row.idempotency_key),
    commandId: String(row.command_id) as DedupRecord["commandId"],
    commandType: String(row.command_type),
    requestDigest: String(row.request_digest),
    status: String(row.status) as DedupStatus,
    ...(result === undefined ? {} : { result }),
  };
}

const RESOURCE_TABLES: Readonly<Record<ResourceRef["type"], string | undefined>> = {
  organization: "aop.organizations:id",
  agent: undefined,
  role: "aop.roles:id",
  goal: "aop.goals:id",
  task: "aop.tasks:id",
  task_run: "aop.task_runs:id",
  lease: "aop.leases:id",
  artifact: "aop.artifacts:id",
  artifact_version: "aop.artifact_versions:id",
  decision: "aop.decisions:id",
  review: "aop.reviews:id",
  permission: "aop.permissions:id",
  approval: "aop.approval_requests:id",
  event: "aop.events:id",
  command: "aop.command_deduplication:command_id",
  context_manifest: "aop.context_manifests:id",
};

export class PostgresCommandTransaction implements TaskClaimTransaction, LeaseRecoveryTransaction {
  readonly #client: PoolClient;

  constructor(client: PoolClient) {
    this.#client = client;
  }

  async findDedup(organizationId: OrganizationId, idempotencyKey: string): Promise<DedupRecord | undefined> {
    await this.#client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 11))", [
      `${organizationId}:${idempotencyKey}`,
    ]);
    const row = await one(
      this.#client,
      `SELECT organization_id, idempotency_key, command_id, command_type, request_digest, status, result
         FROM aop.command_deduplication
        WHERE organization_id = $1 AND idempotency_key = $2`,
      [organizationId, idempotencyKey],
    );
    return row === undefined ? undefined : dedupFromRow(row);
  }

  async beginDedup(input: BeginDedupInput): Promise<void> {
    await this.#client.query(
      `INSERT INTO aop.command_deduplication (
         organization_id, idempotency_key, command_id, command_type, actor_type, actor_id,
         request_digest, status, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'processing',now(),now())`,
      [
        input.organizationId,
        input.idempotencyKey,
        input.commandId,
        input.commandType,
        input.actor.type,
        input.actor.id,
        input.requestDigest,
      ],
    );
  }

  async finishDedup(
    organizationId: OrganizationId,
    idempotencyKey: string,
    status: Exclude<DedupStatus, "processing">,
    result: CommandResult,
  ): Promise<void> {
    const updated = await this.#client.query(
      `UPDATE aop.command_deduplication
          SET status = $3, result = $4::jsonb, updated_at = now()
        WHERE organization_id = $1 AND idempotency_key = $2`,
      [organizationId, idempotencyKey, status, JSON.stringify(result)],
    );
    if (updated.rowCount !== 1) throw new Error("Missing command deduplication record");
  }

  async resourceBelongsToOrganization(organizationId: OrganizationId, resource: ResourceRef): Promise<boolean> {
    if (resource.type === "organization") return resource.id === organizationId;
    if (resource.type === "agent") {
      const row = await one(
        this.#client,
        `SELECT 1 FROM aop.organization_memberships
          WHERE organization_id = $1 AND agent_id = $2`,
        [organizationId, resource.id],
      );
      return row !== undefined;
    }

    const descriptor = RESOURCE_TABLES[resource.type];
    if (descriptor === undefined) return false;
    const [table, idColumn] = descriptor.split(":");
    if (table === undefined || idColumn === undefined) return false;
    const row = await one(
      this.#client,
      `SELECT 1 FROM ${table} WHERE organization_id = $1 AND ${idColumn} = $2`,
      [organizationId, resource.id],
    );
    return row !== undefined;
  }

  async createApprovalRequest(input: ApprovalRequest): Promise<void> {
    const approval = ApprovalRequestSchema.parse(input);
    await this.#client.query(
      `INSERT INTO aop.approval_requests (
         id, organization_id, command_id, command_type, requested_by_type, requested_by_id,
         target_type, target_id, policy_rule, required_authority, risk, evidence, impact_summary,
         estimated_cost_credits, status, expires_at, revision, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)`,
      [
        approval.id,
        approval.organizationId,
        approval.commandId,
        approval.commandType,
        approval.requestedBy.type,
        approval.requestedBy.id,
        approval.target?.type ?? null,
        approval.target?.id ?? null,
        approval.policyRule,
        approval.requiredAuthority,
        approval.risk,
        JSON.stringify(approval.evidence),
        approval.impactSummary,
        approval.estimatedCostCredits ?? null,
        approval.status,
        approval.expiresAt ?? null,
        approval.revision,
        approval.createdAt,
      ],
    );
  }

  async nextOrganizationSequence(organizationId: OrganizationId): Promise<number> {
    await this.#client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 19))", [`event-seq:${organizationId}`]);
    const row = await one(
      this.#client,
      `SELECT COALESCE(MAX(organization_sequence), 0) + 1 AS next_sequence
         FROM aop.events WHERE organization_id = $1`,
      [organizationId],
    );
    if (row === undefined) throw new Error("Could not allocate organization event sequence");
    return Number(row.next_sequence);
  }

  async appendEvent(input: EventEnvelope): Promise<void> {
    const event = EventEnvelopeSchema.parse(input);
    await this.#client.query(
      `INSERT INTO aop.events (
         id, organization_id, organization_sequence, schema_version, protocol_version,
         type, aggregate_type, aggregate_id, aggregate_revision, actor_type, actor_id,
         causation_id, correlation_id, payload, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
      [
        event.eventId,
        event.organizationId,
        event.organizationSequence,
        event.schemaVersion,
        event.protocolVersion,
        event.type,
        event.aggregate.type,
        event.aggregate.id,
        event.aggregateRevision,
        event.actor.type,
        event.actor.id,
        event.causationId ?? null,
        event.correlationId,
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );
  }

  async enqueueOutbox(event: EventEnvelope): Promise<void> {
    await this.#client.query(
      `INSERT INTO aop.outbox_events (event_id, organization_id, status, available_at, created_at)
       VALUES ($1,$2,'pending',now(),now())`,
      [event.eventId, event.organizationId],
    );
  }

  async lockTask(organizationId: OrganizationId, taskId: TaskId): Promise<Task | undefined> {
    const taskRow = await one(
      this.#client,
      `SELECT * FROM aop.tasks WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, taskId],
    );
    if (taskRow === undefined) return undefined;
    const inputRows = await rows(
      this.#client,
      `SELECT av.artifact_id, tai.artifact_version_id, tai.required
         FROM aop.task_artifact_inputs tai
         JOIN aop.artifact_versions av
           ON av.organization_id = tai.organization_id AND av.id = tai.artifact_version_id
        WHERE tai.organization_id = $1 AND tai.task_id = $2
        ORDER BY tai.created_at, tai.artifact_version_id`,
      [organizationId, taskId],
    );
    const inputs = inputRows.map((row) => ({
      artifactId: String(row.artifact_id) as Task["inputs"][number]["artifactId"],
      versionId: String(row.artifact_version_id) as Task["inputs"][number]["versionId"],
      required: Boolean(row.required),
    }));
    return mapTask(taskRow, inputs);
  }

  async hardDependencyBlockers(organizationId: OrganizationId, taskId: TaskId): Promise<readonly TaskId[]> {
    const blockerRows = await rows(
      this.#client,
      `SELECT d.depends_on_task_id
         FROM aop.task_dependencies d
         JOIN aop.tasks prerequisite
           ON prerequisite.organization_id = d.organization_id
          AND prerequisite.id = d.depends_on_task_id
        WHERE d.organization_id = $1
          AND d.task_id = $2
          AND d.dependency_type = 'hard'
          AND prerequisite.state <> 'completed'
        ORDER BY d.depends_on_task_id`,
      [organizationId, taskId],
    );
    return blockerRows.map((row) => String(row.depends_on_task_id) as TaskId);
  }

  async getAgentSchedulingProfile(
    organizationId: OrganizationId,
    agentId: AgentId,
  ): Promise<TaskClaimAgentProfile | undefined> {
    const row = await one(
      this.#client,
      `SELECT m.status, a.capabilities,
              (SELECT count(*) FROM aop.leases l
                WHERE l.organization_id = $1 AND l.agent_id = $2 AND l.status = 'active') AS active_lease_count
         FROM aop.organization_memberships m
         JOIN aop.agents a ON a.id = m.agent_id
        WHERE m.organization_id = $1 AND m.agent_id = $2`,
      [organizationId, agentId],
    );
    if (row === undefined) return undefined;
    const capabilities = json(row.capabilities);
    if (!Array.isArray(capabilities) || !capabilities.every((item) => typeof item === "string")) {
      throw new TypeError("Agent capabilities must be a string array");
    }
    return {
      active: row.status === "active",
      capabilities,
      activeLeaseCount: Number(row.active_lease_count),
    };
  }

  async nextTaskAttempt(organizationId: OrganizationId, taskId: TaskId): Promise<number> {
    const row = await one(
      this.#client,
      `SELECT COALESCE(MAX(attempt), 0) + 1 AS next_attempt
         FROM aop.task_runs WHERE organization_id = $1 AND task_id = $2`,
      [organizationId, taskId],
    );
    return Number(row?.next_attempt ?? 1);
  }

  async persistTaskClaim(task: Task, run: TaskRun, lease: Lease): Promise<void> {
    const previousRevision = task.revision - 1;
    const update = await this.#client.query(
      `UPDATE aop.tasks
          SET owner_agent_id = $3, state = 'leased', revision = $4, updated_at = $5,
              block_reason = NULL, block_detail = NULL, blocked_since = NULL, completed_at = NULL
        WHERE organization_id = $1 AND id = $2 AND revision = $6 AND state = 'ready'`,
      [task.organizationId, task.id, task.ownerAgentId ?? null, task.revision, task.updatedAt, previousRevision],
    );
    if (update.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Task changed before claim persistence", {
        taskId: task.id,
        expectedRevision: previousRevision,
      });
    }

    await this.#client.query(
      `INSERT INTO aop.task_runs (
         id, organization_id, task_id, agent_id, attempt, status, runtime_type,
         runtime_id, workspace_id, snapshot_id, started_at, heartbeat_at, finished_at,
         failure_reason, revision
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        run.id,
        run.organizationId,
        run.taskId,
        run.agentId,
        run.attempt,
        run.status,
        run.runtimeType,
        run.runtimeId ?? null,
        run.workspaceId,
        run.snapshotId ?? null,
        run.startedAt ?? null,
        run.heartbeatAt ?? null,
        run.finishedAt ?? null,
        run.failureReason ?? null,
        run.revision,
      ],
    );

    await this.#client.query(
      `INSERT INTO aop.leases (
         id, organization_id, task_id, run_id, agent_id, status, attempt,
         acquired_at, expires_at, heartbeat_interval_seconds, revision
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        lease.id,
        lease.organizationId,
        lease.taskId,
        lease.runId,
        lease.agentId,
        lease.status,
        lease.attempt,
        lease.acquiredAt,
        lease.expiresAt,
        lease.heartbeatIntervalSeconds,
        lease.revision,
      ],
    );
  }

  async lockLeaseExecution(organizationId: OrganizationId, leaseId: LeaseId): Promise<LeaseExecutionBundle | undefined> {
    const leaseRow = await one(
      this.#client,
      `SELECT * FROM aop.leases WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, leaseId],
    );
    if (leaseRow === undefined) return undefined;

    const runRow = await one(
      this.#client,
      `SELECT * FROM aop.task_runs WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, leaseRow.run_id],
    );
    if (runRow === undefined) throw new Error("Lease references a missing task run");

    const task = await this.lockTask(organizationId, String(leaseRow.task_id) as TaskId);
    if (task === undefined) throw new Error("Lease references a missing task");

    return {
      lease: mapLease(leaseRow),
      run: mapTaskRun(runRow),
      task,
    };
  }

  async persistLeaseHeartbeat(lease: Lease, run: TaskRun): Promise<void> {
    const leaseRevision = lease.revision - 1;
    const runRevision = run.revision - 1;

    const leaseUpdate = await this.#client.query(
      `UPDATE aop.leases
          SET expires_at = $3, revision = $4
        WHERE organization_id = $1 AND id = $2 AND revision = $5 AND status = 'active'`,
      [lease.organizationId, lease.id, lease.expiresAt, lease.revision, leaseRevision],
    );
    if (leaseUpdate.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Lease changed before heartbeat persistence", {
        leaseId: lease.id,
        expectedRevision: leaseRevision,
      });
    }

    const runUpdate = await this.#client.query(
      `UPDATE aop.task_runs
          SET heartbeat_at = $3, revision = $4
        WHERE organization_id = $1 AND id = $2 AND revision = $5
          AND status IN ('created','preparing','running','paused')`,
      [run.organizationId, run.id, run.heartbeatAt ?? null, run.revision, runRevision],
    );
    if (runUpdate.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Task run changed before heartbeat persistence", {
        runId: run.id,
        expectedRevision: runRevision,
      });
    }
  }

  async persistLeaseExpiry(lease: Lease, run: TaskRun, task: Task): Promise<void> {
    const leaseRevision = lease.revision - 1;
    const runRevision = run.revision - 1;
    const taskRevision = task.revision - 1;

    const leaseUpdate = await this.#client.query(
      `UPDATE aop.leases
          SET status = 'expired', revision = $3
        WHERE organization_id = $1 AND id = $2 AND revision = $4 AND status = 'active'`,
      [lease.organizationId, lease.id, lease.revision, leaseRevision],
    );
    if (leaseUpdate.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Lease changed before expiry persistence", {
        leaseId: lease.id,
        expectedRevision: leaseRevision,
      });
    }

    const runUpdate = await this.#client.query(
      `UPDATE aop.task_runs
          SET status = 'lost', finished_at = $3, failure_reason = $4, revision = $5
        WHERE organization_id = $1 AND id = $2 AND revision = $6
          AND status IN ('created','preparing','running','paused')`,
      [run.organizationId, run.id, run.finishedAt ?? null, run.failureReason ?? null, run.revision, runRevision],
    );
    if (runUpdate.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Task run changed before loss persistence", {
        runId: run.id,
        expectedRevision: runRevision,
      });
    }

    const taskUpdate = await this.#client.query(
      `UPDATE aop.tasks
          SET owner_agent_id = NULL, state = 'ready', revision = $3, updated_at = $4,
              block_reason = NULL, block_detail = NULL, blocked_since = NULL, completed_at = NULL
        WHERE organization_id = $1 AND id = $2 AND revision = $5
          AND state IN ('leased','running')`,
      [task.organizationId, task.id, task.revision, task.updatedAt, taskRevision],
    );
    if (taskUpdate.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Task changed before recovery persistence", {
        taskId: task.id,
        expectedRevision: taskRevision,
      });
    }
  }

  async listPermissionsForPrincipal(organizationId: OrganizationId, principal: Principal): Promise<readonly Permission[]> {
    const permissionRows = await rows(
      this.#client,
      `SELECT * FROM aop.permissions
        WHERE organization_id = $1 AND principal_type = $2 AND principal_id = $3
        ORDER BY created_at, id`,
      [organizationId, principal.type, principal.id],
    );
    return permissionRows.map(mapPermission);
  }

  async listActiveRolesForAgent(organizationId: OrganizationId, agentId: AgentId, now: string): Promise<readonly Role[]> {
    const roleRows = await rows(
      this.#client,
      `SELECT r.*
         FROM aop.role_assignments ra
         JOIN aop.roles r ON r.organization_id = ra.organization_id AND r.id = ra.role_id
        WHERE ra.organization_id = $1 AND ra.agent_id = $2
          AND ra.active_from <= $3
          AND (ra.active_until IS NULL OR ra.active_until > $3)
        ORDER BY r.id`,
      [organizationId, agentId, now],
    );
    return roleRows.map((row) => RoleSchema.parse(mapRole(row)));
  }
}

export class PostgresCommandStore implements CommandStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async transaction<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresCommandTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface AuthorizationDataTransaction extends CommandTransaction {
  listPermissionsForPrincipal(organizationId: OrganizationId, principal: Principal): Promise<readonly Permission[]>;
  listActiveRolesForAgent(organizationId: OrganizationId, agentId: AgentId, now: string): Promise<readonly Role[]>;
}

function authorizationTransaction(transaction: CommandTransaction): AuthorizationDataTransaction {
  const candidate = transaction as Partial<AuthorizationDataTransaction>;
  if (typeof candidate.listPermissionsForPrincipal !== "function" || typeof candidate.listActiveRolesForAgent !== "function") {
    throw new Error("Command store does not provide authorization data");
  }
  return transaction as AuthorizationDataTransaction;
}

export class PostgresAuthorizationResolver implements AuthorizationResolver {
  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async resolve(
    command: CommandEnvelope,
    capability: string,
    transaction: CommandTransaction,
  ): Promise<AuthorizationResolution> {
    const tx = authorizationTransaction(transaction);
    const now = this.#now();
    const permissions = await tx.listPermissionsForPrincipal(command.organizationId, command.actor);
    const resolvedRoles =
      command.actor.type === "agent"
        ? await tx.listActiveRolesForAgent(command.organizationId, command.actor.id as AgentId, now)
        : ([] as readonly Role[]);

    return {
      policyInput: {
        organizationId: command.organizationId,
        principal: command.actor,
        capability,
        permissions,
        resolvedRoles,
        now,
        context: { commandType: command.type },
        ...(command.target === undefined ? {} : { resource: command.target }),
      },
      approval: {
        policyRule: "authorization.require_approval",
        requiredAuthority: "human",
        risk: "medium",
        evidence: command.target === undefined ? [] : [command.target],
        impactSummary: `Approval required for ${command.type}`,
      },
    };
  }
}

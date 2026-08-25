import type { Pool, PoolClient } from "pg";

import type {
  CommandStore,
  CommandTransaction,
  DecisionActivationBundle,
  DecisionWriteTransaction,
} from "@aop/command-bus";
import { DomainError } from "@aop/domain";
import type {
  Decision,
  DecisionId,
  OrganizationId,
  ResourceRef,
} from "@aop/protocol";

import { PostgresReviewCommandTransaction } from "./postgres-review-command-store.js";
import { mapDecision, type QueryRow } from "./query-mappers.js";

async function rows(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow[]> {
  const result = await client.query<Record<string, unknown>>(text, [...values]);
  return result.rows;
}

async function one(client: PoolClient, text: string, values: readonly unknown[] = []): Promise<QueryRow | undefined> {
  return (await rows(client, text, values))[0];
}

function affectedResource(row: QueryRow): ResourceRef {
  return { type: String(row.resource_type), id: String(row.resource_id) } as ResourceRef;
}

export class PostgresDecisionCommandTransaction
  extends PostgresReviewCommandTransaction
  implements DecisionWriteTransaction
{
  readonly #decisionClient: PoolClient;

  constructor(client: PoolClient) {
    super(client);
    this.#decisionClient = client;
  }

  async #mapLockedDecision(row: QueryRow): Promise<Decision> {
    const impactRows = await rows(
      this.#decisionClient,
      `SELECT resource_type, resource_id
         FROM aop.decision_impacts
        WHERE organization_id = $1
          AND decision_id = $2
          AND impact_type = 'affected'
        ORDER BY resource_type, resource_id`,
      [row.organization_id, row.id],
    );
    return mapDecision(row, impactRows.map(affectedResource));
  }

  async lockDecisionCreateIdentity(
    organizationId: OrganizationId,
    decisionId: DecisionId,
  ): Promise<Decision | undefined> {
    await this.#decisionClient.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 31))", [
      `decision-create:${organizationId}:${decisionId}`,
    ]);
    return this.lockDecision(organizationId, decisionId);
  }

  async lockDecision(organizationId: OrganizationId, decisionId: DecisionId): Promise<Decision | undefined> {
    const row = await one(
      this.#decisionClient,
      `SELECT * FROM aop.decisions WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, decisionId],
    );
    return row === undefined ? undefined : this.#mapLockedDecision(row);
  }

  async lockDecisionActivationBundle(
    organizationId: OrganizationId,
    decisionId: DecisionId,
    supersedesDecisionId?: DecisionId,
  ): Promise<DecisionActivationBundle | undefined> {
    const ids = [...new Set([decisionId, ...(supersedesDecisionId === undefined ? [] : [supersedesDecisionId])])].sort();
    const lockedRows = await rows(
      this.#decisionClient,
      `SELECT *
         FROM aop.decisions
        WHERE organization_id = $1 AND id = ANY($2::text[])
        ORDER BY id
        FOR UPDATE`,
      [organizationId, ids],
    );
    const decisionRow = lockedRows.find((row) => String(row.id) === decisionId);
    if (decisionRow === undefined) return undefined;
    const decision = await this.#mapLockedDecision(decisionRow);

    if (supersedesDecisionId === undefined) return { decision };
    const supersededRow = lockedRows.find((row) => String(row.id) === supersedesDecisionId);
    if (supersededRow === undefined) return { decision };
    return { decision, supersededDecision: await this.#mapLockedDecision(supersededRow) };
  }

  async persistDecisionCreate(decision: Decision): Promise<void> {
    await this.#decisionClient.query(
      `INSERT INTO aop.decisions (
         id, organization_id, scope, question, options, selected_option_id, rationale,
         proposed_by_type, proposed_by_id, authority_capability, status,
         approved_by_type, approved_by_id, effective_at, supersedes_decision_id,
         revision, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        decision.id,
        decision.organizationId,
        decision.scope,
        decision.question,
        JSON.stringify(decision.options),
        decision.selectedOptionId ?? null,
        decision.rationale ?? null,
        decision.proposedBy.type,
        decision.proposedBy.id,
        decision.authorityCapability,
        decision.status,
        decision.approvedBy?.type ?? null,
        decision.approvedBy?.id ?? null,
        decision.effectiveAt ?? null,
        decision.supersedesDecisionId ?? null,
        decision.revision,
        decision.createdAt,
        decision.updatedAt,
      ],
    );

    for (const resource of decision.affectedResources) {
      await this.#decisionClient.query(
        `INSERT INTO aop.decision_impacts (
           organization_id, decision_id, resource_type, resource_id, impact_type, created_at
         ) VALUES ($1,$2,$3,$4,'affected',$5)`,
        [decision.organizationId, decision.id, resource.type, resource.id, decision.createdAt],
      );
    }
  }

  async #persistDecisionUpdate(decision: Decision): Promise<void> {
    const previousRevision = decision.revision - 1;
    const update = await this.#decisionClient.query(
      `UPDATE aop.decisions
          SET selected_option_id = $3,
              rationale = $4,
              status = $5,
              approved_by_type = $6,
              approved_by_id = $7,
              effective_at = $8,
              revision = $9,
              updated_at = $10
        WHERE organization_id = $1 AND id = $2 AND revision = $11`,
      [
        decision.organizationId,
        decision.id,
        decision.selectedOptionId ?? null,
        decision.rationale ?? null,
        decision.status,
        decision.approvedBy?.type ?? null,
        decision.approvedBy?.id ?? null,
        decision.effectiveAt ?? null,
        decision.revision,
        decision.updatedAt,
        previousRevision,
      ],
    );
    if (update.rowCount !== 1) {
      throw new DomainError("revision_conflict", "Decision changed before persistence", {
        decisionId: decision.id,
        expectedRevision: previousRevision,
      });
    }
  }

  async persistDecisionTransition(decision: Decision): Promise<void> {
    await this.#persistDecisionUpdate(decision);
  }

  async persistDecisionActivation(decision: Decision, supersededDecision?: Decision): Promise<void> {
    await this.#persistDecisionUpdate(decision);
    if (supersededDecision === undefined) return;

    await this.#persistDecisionUpdate(supersededDecision);
    await this.#decisionClient.query(
      `INSERT INTO aop.decision_impacts (
         organization_id, decision_id, resource_type, resource_id, impact_type, detail, created_at
       ) VALUES ($1,$2,'decision',$3,'supersedes',$4,$5)`,
      [
        decision.organizationId,
        decision.id,
        supersededDecision.id,
        `Decision ${decision.id} activated as replacement`,
        decision.effectiveAt ?? decision.updatedAt,
      ],
    );
  }
}

export class PostgresDecisionCommandStore implements CommandStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async transaction<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresDecisionCommandTransaction(client));
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

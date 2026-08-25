import { addArtifactDraftVersion, createArtifactWithInitialDraft, DomainError } from "@aop/domain";
import {
  ArtifactCreatePayloadSchema,
  ArtifactRevisePayloadSchema,
  ArtifactVersionSchema,
  type Artifact,
  type ArtifactId,
  type ArtifactVersion,
  type ArtifactVersionId,
  type CommandEnvelope,
  type OrganizationId,
  type TaskId,
} from "@aop/protocol";

import type { CommandHandler, CommandMutation, CommandTransaction } from "./contracts.js";

export interface ArtifactProductionReferenceCheck {
  readonly taskMissing: boolean;
  readonly missingDerivedVersionIds: readonly ArtifactVersionId[];
}

export interface ArtifactWriteTransaction extends CommandTransaction {
  lockArtifactCreateIdentity(organizationId: OrganizationId, artifactId: ArtifactId): Promise<Artifact | undefined>;
  lockArtifact(organizationId: OrganizationId, artifactId: ArtifactId): Promise<Artifact | undefined>;
  latestArtifactVersion(organizationId: OrganizationId, artifactId: ArtifactId): Promise<ArtifactVersion | undefined>;
  checkArtifactProductionReferences(
    organizationId: OrganizationId,
    producedByTaskId: TaskId | undefined,
    derivedFromVersionIds: readonly ArtifactVersionId[],
  ): Promise<ArtifactProductionReferenceCheck>;
  persistArtifactCreate(artifact: Artifact, version: ArtifactVersion, deliverableType?: string): Promise<void>;
  persistArtifactRevision(artifact: Artifact, version: ArtifactVersion, deliverableType?: string): Promise<void>;
}

function artifactTransaction(transaction: CommandTransaction): ArtifactWriteTransaction {
  const candidate = transaction as Partial<ArtifactWriteTransaction>;
  if (
    typeof candidate.lockArtifactCreateIdentity !== "function" ||
    typeof candidate.lockArtifact !== "function" ||
    typeof candidate.latestArtifactVersion !== "function" ||
    typeof candidate.checkArtifactProductionReferences !== "function" ||
    typeof candidate.persistArtifactCreate !== "function" ||
    typeof candidate.persistArtifactRevision !== "function"
  ) {
    throw new DomainError("internal_error", "Command store does not support Artifact write transactions");
  }
  return transaction as ArtifactWriteTransaction;
}

function targetArtifactId(command: CommandEnvelope): ArtifactId {
  if (command.target?.type !== "artifact") {
    throw new DomainError("validation_error", "artifact.revise requires an Artifact target");
  }
  return command.target.id as ArtifactId;
}

function assertProductionReferences(check: ArtifactProductionReferenceCheck): void {
  if (check.taskMissing) {
    throw new DomainError("scope_mismatch", "producedByTaskId does not reference a Task in this Organization");
  }
  if (check.missingDerivedVersionIds.length > 0) {
    throw new DomainError("scope_mismatch", "derivedFromVersionIds contain versions outside this Organization or missing versions", {
      missingDerivedVersionIds: [...check.missingDerivedVersionIds],
    });
  }
}

function artifactVersionCreatedEvent(version: ArtifactVersion, deliverableType: string | undefined) {
  return {
    type: "artifact_version.created",
    aggregate: { type: "artifact_version" as const, id: version.id },
    aggregateRevision: 0,
    payload: {
      artifactId: version.artifactId,
      version: version.version,
      status: version.status,
      checksum: version.content.checksum,
      producedByTaskId: version.producedByTaskId ?? null,
      deliverableType: deliverableType ?? null,
      derivedFromVersionIds: version.derivedFromVersionIds,
      supersedesVersionId: version.supersedesVersionId ?? null,
    },
  };
}

export class ArtifactCreateHandler implements CommandHandler {
  readonly type = "artifact.create";
  readonly capability = "artifact.create";

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    if (command.target !== undefined) {
      throw new DomainError("validation_error", "artifact.create must not target an existing resource");
    }
    if (command.expectedRevision !== undefined) {
      throw new DomainError("validation_error", "artifact.create must not include expectedRevision");
    }

    const payload = ArtifactCreatePayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "artifact.create payload is invalid", { issues: payload.error.issues });
    }

    const tx = artifactTransaction(transaction);
    const existing = await tx.lockArtifactCreateIdentity(command.organizationId, payload.data.artifactId);
    if (existing !== undefined) {
      throw new DomainError("invariant_violation", "Artifact already exists", { artifactId: payload.data.artifactId });
    }

    assertProductionReferences(
      await tx.checkArtifactProductionReferences(
        command.organizationId,
        payload.data.producedByTaskId,
        payload.data.derivedFromVersionIds,
      ),
    );

    const now = this.#now();
    const version = ArtifactVersionSchema.parse({
      id: payload.data.versionId,
      organizationId: command.organizationId,
      artifactId: payload.data.artifactId,
      version: 1,
      status: "draft",
      createdBy: command.actor,
      content: payload.data.content,
      derivedFromVersionIds: payload.data.derivedFromVersionIds,
      createdAt: now,
      ...(payload.data.producedByTaskId === undefined ? {} : { producedByTaskId: payload.data.producedByTaskId }),
    });
    const created = createArtifactWithInitialDraft(
      {
        id: payload.data.artifactId,
        organizationId: command.organizationId,
        type: payload.data.type,
        title: payload.data.title,
        createdAt: now,
        updatedAt: now,
      },
      version,
    );

    await tx.persistArtifactCreate(created.artifact, created.version, payload.data.deliverableType);

    return {
      resultingRevision: created.artifact.revision,
      events: [
        {
          type: "artifact.created",
          aggregate: { type: "artifact", id: created.artifact.id },
          aggregateRevision: created.artifact.revision,
          correlationId: command.commandId,
          payload: {
            artifactType: created.artifact.type,
            title: created.artifact.title,
            initialVersionId: created.version.id,
          },
        },
        {
          ...artifactVersionCreatedEvent(created.version, payload.data.deliverableType),
          correlationId: command.commandId,
        },
      ],
    };
  }
}

export class ArtifactReviseHandler implements CommandHandler {
  readonly type = "artifact.revise";
  readonly capability = "artifact.revise";
  readonly requiresExpectedRevision = true;

  readonly #now: () => string;

  constructor(now: () => string) {
    this.#now = now;
  }

  async execute(command: CommandEnvelope, transaction: CommandTransaction): Promise<CommandMutation> {
    const payload = ArtifactRevisePayloadSchema.safeParse(command.payload);
    if (!payload.success) {
      throw new DomainError("validation_error", "artifact.revise payload is invalid", { issues: payload.error.issues });
    }
    if (command.expectedRevision === undefined) {
      throw new DomainError("validation_error", "artifact.revise requires expectedRevision");
    }

    const artifactId = targetArtifactId(command);
    const tx = artifactTransaction(transaction);
    const artifact = await tx.lockArtifact(command.organizationId, artifactId);
    if (artifact === undefined) throw new DomainError("not_found", "Artifact was not found", { artifactId });

    const previousVersion = await tx.latestArtifactVersion(command.organizationId, artifactId);
    if (previousVersion === undefined) {
      throw new DomainError("invariant_violation", "Artifact has no version history", { artifactId });
    }

    assertProductionReferences(
      await tx.checkArtifactProductionReferences(
        command.organizationId,
        payload.data.producedByTaskId,
        payload.data.derivedFromVersionIds,
      ),
    );

    const now = this.#now();
    const version = ArtifactVersionSchema.parse({
      id: payload.data.versionId,
      organizationId: command.organizationId,
      artifactId,
      version: previousVersion.version + 1,
      status: "draft",
      createdBy: command.actor,
      content: payload.data.content,
      supersedesVersionId: previousVersion.id,
      derivedFromVersionIds: payload.data.derivedFromVersionIds,
      createdAt: now,
      ...(payload.data.producedByTaskId === undefined ? {} : { producedByTaskId: payload.data.producedByTaskId }),
    });
    const revised = addArtifactDraftVersion(
      artifact,
      version,
      previousVersion,
      command.expectedRevision,
      now,
    );

    await tx.persistArtifactRevision(revised.artifact, revised.version, payload.data.deliverableType);

    return {
      resultingRevision: revised.artifact.revision,
      events: [
        {
          type: "artifact.revised",
          aggregate: { type: "artifact", id: revised.artifact.id },
          aggregateRevision: revised.artifact.revision,
          correlationId: command.commandId,
          payload: {
            versionId: revised.version.id,
            version: revised.version.version,
            supersedesVersionId: previousVersion.id,
          },
        },
        {
          ...artifactVersionCreatedEvent(revised.version, payload.data.deliverableType),
          correlationId: command.commandId,
        },
      ],
    };
  }
}

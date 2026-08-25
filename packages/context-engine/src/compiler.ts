import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  AOP_PROTOCOL_VERSION,
  ContextManifestSchema,
  type AgentId,
  type ContextFragment,
  type ContextFragmentKind,
  type ContextManifest,
  type ContextManifestId,
  type ContextTrust,
  type OrganizationId,
  type ResourceRef,
  type TaskId,
  type TaskRunId,
} from "@aop/protocol";

const KIND_ORDER: readonly ContextFragmentKind[] = [
  "policy",
  "identity",
  "role",
  "authority",
  "goal",
  "task",
  "dependency",
  "decision",
  "artifact",
  "previous_attempt",
  "memory",
  "external_evidence",
  "tool",
  "output_contract",
];

const KIND_RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));

export type ContextCompileErrorCode =
  | "duplicate_fragment_key"
  | "invalid_content"
  | "mandatory_budget_exceeded"
  | "too_many_fragments";

export class ContextCompileError extends Error {
  readonly code: ContextCompileErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ContextCompileErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "ContextCompileError";
    this.code = code;
    this.details = details;
  }
}

export interface ContextCandidate {
  readonly key: string;
  readonly kind: ContextFragmentKind;
  readonly trust: ContextTrust;
  readonly source?: ResourceRef;
  readonly sourceRevision?: number;
  readonly mandatory: boolean;
  readonly relevanceWeight?: number;
  readonly authorityWeight?: number;
  readonly content: unknown;
}

export interface CompileContextManifestInput {
  readonly id: ContextManifestId;
  readonly organizationId: OrganizationId;
  readonly taskId: TaskId;
  readonly runId: TaskRunId;
  readonly agentId: AgentId;
  readonly taskRevision: number;
  readonly candidates: readonly ContextCandidate[];
  readonly maxTokens: number;
  readonly compiledAt: string;
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ContextCompileError("invalid_content", "Context content cannot contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalValue(item ?? null)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`).join(",")}}`;
  }
  throw new ContextCompileError("invalid_content", `Unsupported Context content type: ${typeof value}`);
}

export function canonicalContextContent(value: unknown): string {
  return canonicalValue(value);
}

export function contextDigest(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export function estimateContextTokens(content: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(content, "utf8") / 4));
}

function fragmentFromCandidate(candidate: ContextCandidate): ContextFragment {
  const content = canonicalContextContent(candidate.content);
  const authorityWeight = candidate.authorityWeight ?? (candidate.trust === "authoritative" ? 1 : 0);
  const relevanceWeight = candidate.relevanceWeight ?? 1;

  return {
    key: candidate.key,
    kind: candidate.kind,
    trust: candidate.trust,
    ...(candidate.source === undefined ? {} : { source: candidate.source }),
    ...(candidate.sourceRevision === undefined ? {} : { sourceRevision: candidate.sourceRevision }),
    mandatory: candidate.mandatory,
    authorityWeight,
    relevanceWeight,
    tokenEstimate: estimateContextTokens(content),
    content,
    digest: contextDigest(content),
  };
}

function finalOrder(left: ContextFragment, right: ContextFragment): number {
  return (
    (KIND_RANK.get(left.kind) ?? Number.MAX_SAFE_INTEGER) -
      (KIND_RANK.get(right.kind) ?? Number.MAX_SAFE_INTEGER) ||
    Number(right.mandatory) - Number(left.mandatory) ||
    left.key.localeCompare(right.key)
  );
}

function optionalPriority(left: ContextFragment, right: ContextFragment): number {
  return (
    right.authorityWeight - left.authorityWeight ||
    right.relevanceWeight - left.relevanceWeight ||
    finalOrder(left, right)
  );
}

export function compileContextManifest(input: CompileContextManifestInput): ContextManifest {
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 0) {
    throw new ContextCompileError("invalid_content", "Context token budget must be a non-negative integer", {
      maxTokens: input.maxTokens,
    });
  }

  const keys = input.candidates.map((candidate) => candidate.key);
  if (new Set(keys).size !== keys.length) {
    throw new ContextCompileError("duplicate_fragment_key", "Context candidate keys must be unique");
  }

  const all = input.candidates.map(fragmentFromCandidate);
  if (all.length > 512) {
    throw new ContextCompileError("too_many_fragments", "Context candidate count exceeds protocol maximum", {
      count: all.length,
    });
  }

  const mandatory = all.filter((fragment) => fragment.mandatory);
  const mandatoryTokens = mandatory.reduce((sum, fragment) => sum + fragment.tokenEstimate, 0);
  if (mandatoryTokens > input.maxTokens) {
    throw new ContextCompileError(
      "mandatory_budget_exceeded",
      "Mandatory Context fragments exceed the configured token budget",
      { mandatoryTokens, maxTokens: input.maxTokens },
    );
  }

  let usedTokens = mandatoryTokens;
  const selected = [...mandatory];
  const optional = all.filter((fragment) => !fragment.mandatory).sort(optionalPriority);
  for (const fragment of optional) {
    if (usedTokens + fragment.tokenEstimate > input.maxTokens) continue;
    selected.push(fragment);
    usedTokens += fragment.tokenEstimate;
  }

  selected.sort(finalOrder);

  return ContextManifestSchema.parse({
    schemaVersion: 1,
    protocolVersion: AOP_PROTOCOL_VERSION,
    id: input.id,
    organizationId: input.organizationId,
    taskId: input.taskId,
    runId: input.runId,
    agentId: input.agentId,
    taskRevision: input.taskRevision,
    fragments: selected,
    totalTokenEstimate: usedTokens,
    compiledAt: input.compiledAt,
  });
}

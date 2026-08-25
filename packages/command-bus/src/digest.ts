import { createHash } from "node:crypto";

import type { CommandEnvelope } from "@aop/protocol";

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Command digest only supports finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new TypeError(`Unsupported command digest value: ${typeof value}`);
}

export function semanticCommandDigest(command: CommandEnvelope): string {
  const semanticRequest = {
    schemaVersion: command.schemaVersion,
    protocolVersion: command.protocolVersion,
    type: command.type,
    organizationId: command.organizationId,
    actor: command.actor,
    target: command.target,
    expectedRevision: command.expectedRevision,
    payload: command.payload,
  };
  return `sha256:${createHash("sha256").update(canonicalJson(semanticRequest)).digest("hex")}`;
}

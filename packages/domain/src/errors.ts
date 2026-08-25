import type { ProtocolErrorCode } from "@aop/protocol";

export class DomainError extends Error {
  readonly code: ProtocolErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function assertExpectedRevision(currentRevision: number, expectedRevision: number): void {
  if (currentRevision !== expectedRevision) {
    throw new DomainError("revision_conflict", "Aggregate revision does not match expected revision", {
      currentRevision,
      expectedRevision,
    });
  }
}

export function invariant(condition: boolean, message: string, details: Readonly<Record<string, unknown>> = {}): asserts condition {
  if (!condition) {
    throw new DomainError("invariant_violation", message, details);
  }
}

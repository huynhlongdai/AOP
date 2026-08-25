import { describe, expect, it } from "vitest";

import type { ContextCandidate } from "./compiler.js";
import {
  ContextCompileError,
  canonicalContextContent,
  compileContextManifest,
  contextDigest,
} from "./compiler.js";

const ULID = "00000000000000000000000001";
const ids = {
  id: `ctx_${ULID}` as const,
  organizationId: `org_${ULID}` as const,
  taskId: `tsk_${ULID}` as const,
  runId: `run_${ULID}` as const,
  agentId: `agt_${ULID}` as const,
};
const compiledAt = "2026-08-25T15:30:00.000Z";

function mandatory(kind: ContextCandidate["kind"], content: unknown): ContextCandidate {
  return {
    key: `mandatory:${kind}`,
    kind,
    trust: "authoritative",
    mandatory: true,
    content,
  };
}

function baseCandidates(): ContextCandidate[] {
  return [
    mandatory("policy", { autonomy: "human_managed" }),
    mandatory("identity", { agent: "CTO" }),
    mandatory("role", { role: "CTO" }),
    mandatory("authority", { allowed: ["task.create"] }),
    mandatory("goal", { objective: "Build product" }),
    mandatory("task", { objective: "Decompose engineering work" }),
    mandatory("output_contract", { output: "AOP Commands" }),
  ];
}

describe("Context Manifest compiler", () => {
  it("canonicalizes object keys before hashing", () => {
    const left = canonicalContextContent({ z: 2, a: { y: 1, b: true } });
    const right = canonicalContextContent({ a: { b: true, y: 1 }, z: 2 });

    expect(left).toBe(right);
    expect(contextDigest(left)).toBe(contextDigest(right));
  });

  it("produces stable exact fragments with all mandatory classes", () => {
    const candidates = [
      ...baseCandidates(),
      {
        key: "external:issue",
        kind: "external_evidence" as const,
        trust: "untrusted" as const,
        mandatory: false,
        relevanceWeight: 0.9,
        content: { text: "User supplied issue text" },
      },
    ];

    const first = compileContextManifest({ ...ids, taskRevision: 4, candidates, maxTokens: 20_000, compiledAt });
    const second = compileContextManifest({ ...ids, taskRevision: 4, candidates, maxTokens: 20_000, compiledAt });

    expect(first).toEqual(second);
    expect(first.fragments.map((fragment) => fragment.kind)).toEqual([
      "policy",
      "identity",
      "role",
      "authority",
      "goal",
      "task",
      "external_evidence",
      "output_contract",
    ]);
    expect(first.fragments.every((fragment) => fragment.content.length > 0 && fragment.digest.startsWith("sha256:"))).toBe(true);
    expect(first.fragments.find((fragment) => fragment.trust === "untrusted")?.authorityWeight).toBe(0);
  });

  it("never drops mandatory fragments to satisfy the token budget", () => {
    expect(() =>
      compileContextManifest({
        ...ids,
        taskRevision: 4,
        candidates: baseCandidates(),
        maxTokens: 1,
        compiledAt,
      }),
    ).toThrowError(ContextCompileError);

    try {
      compileContextManifest({
        ...ids,
        taskRevision: 4,
        candidates: baseCandidates(),
        maxTokens: 1,
        compiledAt,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ContextCompileError);
      expect((error as ContextCompileError).code).toBe("mandatory_budget_exceeded");
    }
  });

  it("selects optional fragments deterministically by authority/relevance without exceeding budget", () => {
    const baseline = compileContextManifest({
      ...ids,
      taskRevision: 4,
      candidates: baseCandidates(),
      maxTokens: 20_000,
      compiledAt,
    });

    const candidates: ContextCandidate[] = [
      ...baseCandidates(),
      {
        key: "memory:low",
        kind: "memory",
        trust: "derived",
        mandatory: false,
        relevanceWeight: 0.2,
        content: "x".repeat(80),
      },
      {
        key: "memory:high",
        kind: "memory",
        trust: "derived",
        mandatory: false,
        relevanceWeight: 0.9,
        content: "y".repeat(80),
      },
    ];

    const highFragment = compileContextManifest({
      ...ids,
      taskRevision: 4,
      candidates: [...baseCandidates(), candidates[candidates.length - 1]!],
      maxTokens: 20_000,
      compiledAt,
    }).fragments.find((fragment) => fragment.key === "memory:high")!;

    const budget = baseline.totalTokenEstimate + highFragment.tokenEstimate;
    const manifest = compileContextManifest({ ...ids, taskRevision: 4, candidates, maxTokens: budget, compiledAt });

    expect(manifest.totalTokenEstimate).toBeLessThanOrEqual(budget);
    expect(manifest.fragments.some((fragment) => fragment.key === "memory:high")).toBe(true);
    expect(manifest.fragments.some((fragment) => fragment.key === "memory:low")).toBe(false);
  });

  it("rejects duplicate fragment identities instead of silently overwriting context", () => {
    const candidates = [...baseCandidates(), { ...mandatory("decision", { id: "D1" }), key: "mandatory:task" }];
    expect(() =>
      compileContextManifest({ ...ids, taskRevision: 4, candidates, maxTokens: 20_000, compiledAt }),
    ).toThrowError(/unique/);
  });
});

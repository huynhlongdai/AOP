import { describe, expect, it } from "vitest";

import { readOpenAIRuntimeWorkerConfig } from "./openai-runtime-config.js";

describe("readOpenAIRuntimeWorkerConfig", () => {
  it("keeps provider execution disabled by default without requiring secrets", () => {
    expect(readOpenAIRuntimeWorkerConfig({})).toEqual({
      enabled: false,
      modelPolicies: {},
      maxConcurrent: 1,
      maxContextTokens: 16_000,
      maxOutputTokens: 2_000,
      idleDelayMs: 1_000,
    });
  });

  it("requires an API key when OpenAI Runtime dispatch is explicitly enabled", () => {
    expect(() =>
      readOpenAIRuntimeWorkerConfig({
        RUNTIME_OPENAI_ENABLED: "true",
        OPENAI_DEFAULT_MODEL: "gpt-5.5",
      }),
    ).toThrow(/requires OPENAI_API_KEY/);
  });

  it("requires an explicit default model or policy map when enabled", () => {
    expect(() =>
      readOpenAIRuntimeWorkerConfig({
        RUNTIME_OPENAI_ENABLED: "1",
        OPENAI_API_KEY: "test-key",
      }),
    ).toThrow(/requires OPENAI_DEFAULT_MODEL or at least one OPENAI_MODEL_POLICIES_JSON entry/);
  });

  it("parses bounded model policy and dispatch limits", () => {
    expect(
      readOpenAIRuntimeWorkerConfig({
        RUNTIME_OPENAI_ENABLED: "yes",
        OPENAI_API_KEY: "test-key",
        OPENAI_DEFAULT_MODEL: "gpt-5.5",
        OPENAI_MODEL_POLICIES_JSON: JSON.stringify({ engineering: "gpt-5.5", review: "gpt-5-mini" }),
        RUNTIME_OPENAI_MAX_CONCURRENT: "3",
        RUNTIME_OPENAI_MAX_CONTEXT_TOKENS: "24000",
        RUNTIME_OPENAI_MAX_OUTPUT_TOKENS: "4096",
        RUNTIME_OPENAI_IDLE_DELAY_MS: "1500",
      }),
    ).toEqual({
      enabled: true,
      defaultModel: "gpt-5.5",
      modelPolicies: { engineering: "gpt-5.5", review: "gpt-5-mini" },
      maxConcurrent: 3,
      maxContextTokens: 24_000,
      maxOutputTokens: 4_096,
      idleDelayMs: 1_500,
    });
  });

  it("rejects malformed policy JSON and unsafe numeric bounds", () => {
    const base = {
      RUNTIME_OPENAI_ENABLED: "true",
      OPENAI_API_KEY: "test-key",
      OPENAI_DEFAULT_MODEL: "gpt-5.5",
    } as const;

    expect(() =>
      readOpenAIRuntimeWorkerConfig({ ...base, OPENAI_MODEL_POLICIES_JSON: "[\"gpt-5.5\"]" }),
    ).toThrow(/must be a JSON object/);
    expect(() =>
      readOpenAIRuntimeWorkerConfig({ ...base, RUNTIME_OPENAI_MAX_CONCURRENT: "101" }),
    ).toThrow(/between 1 and 100/);
    expect(() =>
      readOpenAIRuntimeWorkerConfig({ ...base, RUNTIME_OPENAI_IDLE_DELAY_MS: "0" }),
    ).toThrow(/between 1 and 60000/);
  });
});

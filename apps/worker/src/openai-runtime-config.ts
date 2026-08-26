const MODEL_POLICY_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/;

export interface OpenAIRuntimeWorkerConfig {
  readonly enabled: boolean;
  readonly modelPolicies: Readonly<Record<string, string>>;
  readonly defaultModel?: string;
  readonly maxConcurrent: number;
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly idleDelayMs: number;
}

function boolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) return fallback;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`${name} must be a boolean (true/false, 1/0, yes/no, on/off)`);
  }
}

function positiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function model(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 160) {
    throw new Error(`${field} must be a non-empty model identifier with at most 160 characters`);
  }
  return normalized;
}

function modelPolicies(raw: string | undefined): Readonly<Record<string, string>> {
  if (raw === undefined || raw.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`OPENAI_MODEL_POLICIES_JSON must be valid JSON: ${detail}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OPENAI_MODEL_POLICIES_JSON must be a JSON object mapping policy names to model identifiers");
  }

  const result: Record<string, string> = {};
  for (const [policy, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!MODEL_POLICY_PATTERN.test(policy)) {
      throw new Error(`Invalid OpenAI model policy name: ${policy}`);
    }
    if (typeof value !== "string") {
      throw new Error(`OpenAI model policy ${policy} must map to a string model identifier`);
    }
    const resolved = model(value, `OpenAI model policy ${policy}`);
    if (resolved === undefined) throw new Error(`OpenAI model policy ${policy} is empty`);
    result[policy] = resolved;
  }
  return result;
}

export function readOpenAIRuntimeWorkerConfig(
  env: Readonly<Record<string, string | undefined>>,
): OpenAIRuntimeWorkerConfig {
  const enabled = boolean("RUNTIME_OPENAI_ENABLED", env.RUNTIME_OPENAI_ENABLED, false);
  if (!enabled) {
    return {
      enabled: false,
      modelPolicies: {},
      maxConcurrent: 1,
      maxContextTokens: 16_000,
      maxOutputTokens: 2_000,
      idleDelayMs: 1_000,
    };
  }

  if (env.OPENAI_API_KEY === undefined || env.OPENAI_API_KEY.trim().length === 0) {
    throw new Error("RUNTIME_OPENAI_ENABLED=true requires OPENAI_API_KEY");
  }

  const policies = modelPolicies(env.OPENAI_MODEL_POLICIES_JSON);
  const defaultModel = model(env.OPENAI_DEFAULT_MODEL, "OPENAI_DEFAULT_MODEL");
  if (defaultModel === undefined && Object.keys(policies).length === 0) {
    throw new Error(
      "RUNTIME_OPENAI_ENABLED=true requires OPENAI_DEFAULT_MODEL or at least one OPENAI_MODEL_POLICIES_JSON entry",
    );
  }

  return {
    enabled: true,
    modelPolicies: policies,
    ...(defaultModel === undefined ? {} : { defaultModel }),
    maxConcurrent: positiveInteger(
      "RUNTIME_OPENAI_MAX_CONCURRENT",
      env.RUNTIME_OPENAI_MAX_CONCURRENT,
      1,
      100,
    ),
    maxContextTokens: positiveInteger(
      "RUNTIME_OPENAI_MAX_CONTEXT_TOKENS",
      env.RUNTIME_OPENAI_MAX_CONTEXT_TOKENS,
      16_000,
      1_000_000,
    ),
    maxOutputTokens: positiveInteger(
      "RUNTIME_OPENAI_MAX_OUTPUT_TOKENS",
      env.RUNTIME_OPENAI_MAX_OUTPUT_TOKENS,
      2_000,
      1_000_000,
    ),
    idleDelayMs: positiveInteger(
      "RUNTIME_OPENAI_IDLE_DELAY_MS",
      env.RUNTIME_OPENAI_IDLE_DELAY_MS,
      1_000,
      60_000,
    ),
  };
}

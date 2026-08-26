# T0033 — OpenAI Runtime Dispatch

Status: **PASS**

Branch: `implementation/slice-3`

Validation evidence: GitHub Actions CI #300 (`32927428385`) passed both workspace and PostgreSQL jobs on head `f320d261996044514e8533e4bc1067855173f138`.

## Goal

Connect the first production-capable provider Runtime to the worker without allowing the provider to bypass the AOP Kernel, and without making provider execution implicit or mandatory for non-runtime worker deployments.

## Execution boundary

The production path is:

```text
PostgresRuntimeCandidateStore
  -> PostgresRuntimeExecutionPolicyResolver
  -> RuntimeDispatcher
  -> RuntimeManager
  -> OpenAIRuntimeAdapter
       prepare()        -- no provider I/O / no Context
  -> GatewayKernelRuntimePort
       task_run.prepare
       task_run.start
  -> PostgresContextManifestStore
       exact Context Manifest compiled at running Task revision
  -> OpenAI Responses transport
       structured bounded result only
  -> GatewayAgentCommandBridge
       model proposals rebound to trusted org/agent/run identity
  -> CommandGateway / Policy / Domain transaction
  -> task_run.finish + immutable Runtime Run Report
```

The provider never receives Kernel database credentials and never supplies authoritative actor, organization, command ID, idempotency key, protocol metadata, or lifecycle state.

## OpenAI adapter

`@aop/runtime-openai` implements the RuntimeAdapter contract:

- `prepare`
- `start`
- `cancel`
- `inspect`
- usage accounting
- provider trace references

The real transport uses the OpenAI Responses API structured-output parser with a strict Zod schema. Model output is converted only into bounded Runtime command proposals and structured output. Provider output never mutates organizational state directly.

The adapter validates:

- resolved model identifier
- Runtime identity
- exact Context payload and trust labels
- command proposal target shape
- JSON object command payloads
- succeeded/failed/cancelled output shape
- cancellation through AbortSignal

## Runtime dispatch selection

The PostgreSQL selector only returns Runs that are all of the following:

- TaskRun `created`
- Task `leased`
- active Lease that has not expired
- active Organization
- active Agent membership
- active Role assignment
- TaskRun runtime type matches the requested adapter
- Agent runtime adapter matches the requested adapter
- no Context Manifest already exists for the Run

Ordering is deterministic by Task priority, Lease acquisition time, Task creation time, attempt, and Run ID.

Multiple workers may observe the same candidate, but Runtime preparation is fenced by Kernel expected revision. A losing worker is classified as contention rather than a provider failure; provider I/O has not started at that point.

## Runtime execution policy

Runtime policy is resolved from authoritative AOP permissions through the same Policy Engine used by the Command Gateway.

T0033 production command surface is intentionally narrow:

- `task.submit_review`

The dispatcher refuses to execute a provider Runtime if the Agent lacks ALLOW authority for the required completion command.

Additional commands such as `task.create` must not be exposed merely because the model can emit them. They are enabled only after their protocol, handler, transaction, permission, and tests exist.

## Worker composition

The worker now composes four independent loops:

1. durable Outbox delivery
2. deterministic Scheduler
3. Lease Reaper
4. optional OpenAI Runtime Dispatcher

OpenAI Runtime execution is **disabled by default**. This avoids accidental provider calls and API spend.

Enable explicitly with:

```text
RUNTIME_OPENAI_ENABLED=true
OPENAI_API_KEY=...
```

At least one model resolution source is also required:

```text
OPENAI_DEFAULT_MODEL=<model>
```

or:

```text
OPENAI_MODEL_POLICIES_JSON={"engineering":"<model>","review":"<model>"}
```

Optional bounded controls:

```text
RUNTIME_OPENAI_MAX_CONCURRENT=1
RUNTIME_OPENAI_MAX_CONTEXT_TOKENS=16000
RUNTIME_OPENAI_MAX_OUTPUT_TOKENS=2000
RUNTIME_OPENAI_IDLE_DELAY_MS=1000
```

Configuration fails closed when explicitly enabled but missing an API key/model configuration, when policy JSON is malformed, or when numeric limits are outside accepted bounds.

## Kernel handler wiring

Production CommandGateway now includes `TaskSubmitReviewHandler`. This is required because the Runtime policy exposes `task.submit_review`; a command must never be advertised to a model unless production Kernel composition can actually process it.

## Tests

T0033 adds or relies on evidence for:

- OpenAI adapter prepares without provider I/O
- exact Context/trust labels are sent only at `start`
- structured provider output becomes bounded proposals
- malformed command payload fails closed
- in-flight provider request can be cancelled
- provider dispatch is skipped without required completion authority
- deterministic Context Manifest ID for a Run
- heartbeat cadence is faster than Lease interval
- Kernel lifecycle race is classified as contention
- OpenAI Runtime configuration is disabled by default
- explicit enable requires API key and model resolution
- malformed model policy config and unsafe limits are rejected
- full workspace lint/typecheck/test/build
- full PostgreSQL regression suite through Runtime Manager control plane

## Remaining Slice 3 work

T0033 makes the real provider execution boundary production-capable, but it does **not** yet satisfy the full CTO decomposition scenario.

Next required vertical slice:

- add bounded `task.create` protocol + Kernel handler + PostgreSQL transaction
- require explicit Agent permission
- allow CTO Agent to create child Work Contracts only inside its Organization/Goal authority
- preserve idempotency, scope, revision and event/outbox invariants
- expose `task.create` to Runtime policy only after those tests pass
- run the first real CTO decomposition scenario

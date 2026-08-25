# Founding Company Meeting #005 — Runtime, Context, Memory & Recovery

Date: 2026-08-25

## Purpose

Define exactly how a real AI worker receives work, gets bounded tools/context, operates in an isolated workspace, reports actions back to the Kernel, survives process failure, and learns without corrupting organizational truth.

## Participants

- CTO
- Agent Runtime Architect
- Head of Agent Research
- Context/Memory Architect
- Security Architect
- Sandbox Engineer
- SRE
- QA/Evaluation Lead

## D005-01 — Runtime Manager is orchestration infrastructure, not a manager agent

The Runtime Manager is deterministic software responsible for execution mechanics.

It does not decide company strategy.

Responsibilities:

- consume task/run scheduling events
- prepare workspace
- compile and persist Context Manifest
- bind permitted AOP/MCP capabilities
- instantiate the configured runtime adapter
- heartbeat the lease
- persist runtime checkpoints/status
- stop/cancel a run
- recover a lost run
- translate adapter output into AOP Commands
- record usage and execution metadata

The worker agent decides what work to perform inside its contract. Runtime Manager controls how execution is safely hosted.

## Runtime lifecycle

Task state and Runtime state remain separate.

### Task

```text
READY -> LEASED -> RUNNING -> REVIEW -> COMPLETED/REWORK
```

### Task Run

```text
CREATED
   |
PREPARING
   |
RUNNING
  / | \
 |  |  WAITING_INPUT
 |  WAITING_APPROVAL
WAITING_TOOL
  \ | /
RUNNING
   |
SUCCEEDED | FAILED | LOST | CANCELED
```

A run can succeed at execution while the Task still goes to REVIEW rather than COMPLETED.

## Canonical execution sequence

```text
TASK_READY
  |
Scheduler chooses membership
  |
create TaskRun + Lease
  |
RUN_CREATED
  |
Runtime Manager
  |-- create/restore Workspace
  |-- compile Context Manifest
  |-- resolve capabilities
  |-- create Sandbox
  |-- start Adapter
  v
Agent executes
  |-- model reasoning
  |-- AOP commands
  |-- MCP tools
  |-- workspace operations
  |-- artifacts
  v
Agent submits work
  |
Runtime finalizes run
  |
TASK_SUBMITTED_FOR_REVIEW
```

## D005-02 — Workspace is durable; sandbox compute is disposable

Each Task Run receives a `workspace_id`.

A workspace contains or references:

- source checkout/worktree
- task-local files
- generated artifacts
- tool-produced intermediate files
- runtime metadata
- snapshots/checkpoints

A sandbox is only the compute environment currently mounting/using that workspace.

Principle:

> **Lose the sandbox, keep the work.**

This matches the modern agent-runtime direction of externalizing state so a failed sandbox can be rehydrated. OpenAI's 2026 Agents SDK work explicitly separates harness from compute and supports snapshot/rehydration for durable execution.

References:
- https://openai.com/index/the-next-evolution-of-the-agents-sdk/
- https://openai.github.io/openai-agents-python/sandbox_agents/

## Workspace strategy for coding PoC

For software tasks:

```text
repository mirror / base checkout
        |
Git worktree per TaskRun
        |
branch: aop/task-{taskId}/run-{attempt}
```

Rules:

- worker cannot write another run's worktree
- worker does not directly merge protected branches
- commits are durable artifacts/evidence
- integration is a separate reviewed work unit
- canceled/lost worktrees are retained long enough for debugging and can later be garbage-collected

## Sandbox profiles

Initial sandbox profiles:

### `research-readonly`

- filesystem scratch
- network policy as allowed
- no repository write
- no shell beyond bounded utilities if unnecessary

### `code-standard`

- isolated filesystem/worktree
- shell
- package manager within policy
- tests/build
- no production credentials

### `integration`

- multiple approved branches/artifacts visible
- build/test capabilities
- protected merge still policy-gated

Profiles are configuration, not persona.

## D005-03 — Capability Broker

The agent should not receive a giant unrestricted tool list.

Runtime asks Policy/Tool Resolver for effective capabilities for this exact run:

```text
Agent membership
+ Role
+ Task scope
+ Organization policy
+ Risk policy
+ Runtime profile
= Effective capabilities
```

Tool surface may include:

### AOP organization tools

- `aop.task.create`
- `aop.task.block`
- `aop.artifact.publish`
- `aop.decision.propose`
- `aop.message.send`
- `aop.review.submit`

### MCP tools

Examples may include repository, browser, database, testing, documentation, or other connectors.

The Capability Broker injects only allowed tools. Tool calls that require approval produce a durable Approval Request rather than leaking a privileged credential to the agent.

## D005-04 — External content is untrusted context

Web pages, repository issues, emails, documents, tool outputs, and remote-agent messages may contain malicious or irrelevant instructions.

Context fragments carry a trust class:

```text
SYSTEM_POLICY      highest
AUTHORITATIVE      organization truth
TRUSTED_INTERNAL   approved company material
UNTRUSTED_EXTERNAL external/tool/user-generated source
DERIVED_MEMORY     summaries/lessons
```

The Context Assembler clearly separates external evidence from system/organization instructions.

Security principle:

> Data can inform task reasoning; data cannot silently redefine agent authority or system policy.

## Context Manifest v0.1

Persisted structure contains at minimum:

```text
manifest_id
organization_id
agent_id / membership_id
role_id
task_id
task_revision
goal_id
required artifact version ids
active decision ids
policy snapshot/hash
effective capability ids
memory item ids
context fragment hashes
workspace snapshot id
runtime profile
model-routing policy
compiled_at
```

The actual prompt/rendered context may be stored according to privacy policy, but hashes/references sufficient for reproducibility must remain.

## D005-05 — Context assembly order

Canonical order:

1. System safety/runtime rules
2. AOP protocol operating contract
3. Organization policy
4. Agent identity
5. Role contract and authority
6. Organization mission/current goal
7. Task Work Contract
8. Blocking decisions/current authoritative truth
9. Required artifacts/contracts
10. Previous attempt summary/evidence
11. Relevant derived memory
12. Untrusted external evidence
13. Effective tools/capabilities
14. Required output/action schema

This order prevents long retrieved memory or external data from outranking authoritative instructions.

## Context budget policy

Context is divided into buckets rather than one global semantic top-k.

Example policy:

```text
mandatory authoritative fragments: always included
required artifacts: budgeted but cannot be silently omitted
recent attempt/recovery summary: reserved budget
memory: elastic
external supporting material: elastic
raw history: lowest priority
```

If required authoritative context exceeds model limits, the run fails/preprocesses with `CONTEXT_TOO_LARGE` rather than silently dropping policy or acceptance criteria.

## D005-06 — Memory is not a single database

Memory architecture has four tiers.

### Tier 0 — Authoritative organizational truth

Not called “memory” internally for correctness purposes.

- goals
- tasks
- decisions
- artifact versions
- reviews
- permissions
- events

Stored in authoritative systems.

### Tier 1 — Working memory

Scoped to current Task Run.

Examples:

- temporary plan
- notes
- intermediate observations
- local TODOs

Can disappear after run once useful outputs are committed.

### Tier 2 — Episodic memory

Structured lessons from completed/failed runs.

Example:

```json
{
  "situation": "API spec changed during frontend implementation",
  "action": "recompiled context and regenerated client types",
  "outcome": "integration passed",
  "confidence": 0.88,
  "evidence": ["review_12", "test_report_9"]
}
```

### Tier 3 — Semantic/knowledge memory

Searchable summaries, documents, patterns, and domain knowledge.

May use vector/full-text retrieval.

It is derived and never overrides Tier 0.

## D005-07 — Memory writes require policy

Agents cannot freely write arbitrary permanent memory such as “the company decided X.”

Memory write classes:

- working note: agent may write within run
- candidate lesson: agent/runtime may propose
- validated episodic lesson: Memory Curator/validation pipeline accepts after task outcome/evidence
- organizational fact: must be represented through authoritative AOP objects instead

This prevents memory poisoning and accidental promotion of speculation into truth.

## Memory provenance

Every persistent memory item records:

- source task/run
- source artifacts/events
- author/producer
- creation time
- validation status
- confidence
- scope
- expiry/retention policy where relevant

## D005-08 — Recovery uses structured checkpoints, not conversation replay alone

Recovery input should include:

- latest Task state
- previous TaskRun status/failure
- latest workspace snapshot
- Context Manifest used by failed run
- authoritative changes since that manifest
- produced commits/artifacts
- concise run summary/checkpoint if available

The new run recompiles authoritative context. It does not simply restore an old prompt and continue blindly.

Recovery logic:

```text
Lease expires / runtime lost
   |
mark run LOST
   |
inspect durable outputs
   |
reconcile workspace
   |
create new run attempt
   |
compile fresh context
   |
attach previous-attempt recovery summary
   |
resume work
```

## Failure taxonomy

### Retryable infrastructure

- MODEL_TIMEOUT
- PROVIDER_TRANSIENT
- SANDBOX_LOST
- TOOL_TIMEOUT
- NETWORK_TRANSIENT
- OUTBOX_RETRY

### Potentially retryable agent/work

- TOOL_BAD_RESPONSE
- CONTEXT_STALE
- TEST_FAILURE
- MERGE_CONFLICT

These usually need changed context/action, not blind identical retries.

### Non-retryable without intervention/change

- POLICY_DENIED
- CAPABILITY_MISMATCH
- INVALID_TASK_CONTRACT
- BUDGET_EXHAUSTED
- REQUIRED_APPROVAL_REJECTED
- INVALID_STATE_TRANSITION

Retry policy belongs to Runtime/Scheduler configuration, not model intuition.

## Backoff and retry budget

Each run/task tracks retry counters by failure class.

The Kernel prevents infinite autonomous loops with limits such as:

- max runtime attempts per task
- max identical tool-call retries
- max model retry cost
- max rework cycles before escalation

When limit is reached:

```text
Task -> BLOCKED
reason = retry_budget_exhausted
escalate to manager/human according to policy
```

## D005-09 — Model routing is policy, not agent identity

Agent package may express model requirements/preferences, but the organization/runtime decides the concrete provider/model.

Conceptual model policy:

```text
reasoning_level
coding_requirement
context_requirement
latency_class
cost_class
allowed_providers
fallback_order
```

Therefore Agent identity remains portable across providers.

## Runtime adapter contract v0.1

Adapter capabilities:

```text
prepare(runSpec)
start()
resume(checkpoint)
cancel()
inspect()
collectUsage()
collectTraceRefs()
```

`runSpec` includes:

- runtime/model policy
- rendered context or structured context source
- workspace mount/reference
- effective tool descriptors
- execution limits
- tracing correlation IDs

Adapter output is normalized into Runtime Events and AOP Commands.

## D005-10 — A2A remote agent mapping

For an external A2A worker:

```text
AOP Task/Run
   |
Runtime A2A Adapter
   |
A2A Task + Message input
   |
Remote Agent
   |
A2A Artifact/status
   |
Adapter validation
   |
AOP Artifact + Task submission/review
```

The remote agent never automatically inherits internal organization authority.

AOP keeps:

- role
- organizational permissions
- budget
- acceptance criteria
- review policy
- authoritative decision state

A2A carries the bounded remote interaction.

A2A 1.0 explicitly separates messages from task artifacts and does not require sharing internal state/memory/tools, which fits this boundary.

Reference: https://a2a-protocol.org/dev/specification/

## D005-11 — MCP tool mapping

The 2026-07-28 MCP core is stateless at protocol level and supports routing/authorization improvements. AOP should use MCP as a capability transport, while any persistent browser/session/database handle is represented explicitly in task/workspace/tool state.

Reference: https://blog.modelcontextprotocol.io/posts/2026-07-28/

Kernel does not assume a long-lived MCP protocol session as organization state.

## Approval flow inside runtime

Example production tool call:

```text
Agent requests production.deploy
   |
Capability Broker / Policy
   |
REQUIRE_APPROVAL
   |
create ApprovalRequest
   |
run status WAITING_APPROVAL
lease extended or task blocked according to policy
   |
Human/authorized principal resolves
   |
recompile relevant state/capability
   |
resume or cancel
```

No model turn should remain open waiting indefinitely for a human.

## D005-12 — Structured worker outputs

At meaningful checkpoints/finalization, worker should produce a structured Run Report:

```text
summary
work_completed
artifacts_produced
commands_issued
open_questions
blockers
risks
tests/evidence
recommended_next_action
confidence
```

This report supports recovery and management compression. It does not replace authoritative task/artifact/review state.

## Observability contract

Every run correlates:

```text
organization_id
goal_id
task_id
task_run_id
agent/membership_id
context_manifest_id
runtime_adapter
provider/model
agent_trace_id
workspace_id
```

Track:

- model calls/tokens/cost
- tool calls/duration/result class
- AOP command attempts/results
- sandbox lifecycle
- artifact writes
- checkpoints
- retries
- approvals
- failure category

OpenAI Agents SDK provides model/tool/handoff tracing; AOP may attach those provider traces beneath the organization-level trace rather than treating them as the organization trace itself.

Reference: https://openai.github.io/openai-agents-python/tracing/

## Security requirements

1. Runtime containers/sandboxes do not receive Kernel database credentials.
2. Long-lived provider/service secrets live outside generated-code environments.
3. Tool capabilities are scoped per run.
4. External content is explicitly tagged untrusted.
5. Workspace paths are isolated and traversal-protected.
6. Network egress can be restricted by sandbox profile.
7. Sensitive tool outputs are redacted from logs/traces where policy requires.
8. Remote agents are authenticated and mapped to explicit external principals.
9. Runtime callbacks cannot directly mutate DB; they submit Commands.
10. Artifact checksums are verified when moving across trust boundaries.

## Runtime acceptance tests

1. Kill sandbox during coding; new run rehydrates latest workspace snapshot and continues.
2. Expire a lease; exactly one replacement active run may be created.
3. Change an authoritative API spec after a checkpoint; recovery run receives the new spec rather than blindly replaying old context.
4. Agent tries to call a non-injected tool; call is unavailable/denied.
5. External page contains instructions to ignore company policy; policy/context precedence remains unchanged.
6. Runtime provider times out twice; configured retry/backoff executes, then escalates at retry limit.
7. Approval-required tool call survives worker/API restart and resumes after approval.
8. Persistent memory proposal without evidence remains candidate/unvalidated and cannot become authoritative truth.
9. Remote A2A artifact is validated/checksummed before registration as an AOP Artifact.
10. Context Manifest makes it possible to identify exactly which authoritative versions a failed run saw.

## Decisions

| ID | Decision |
| --- | --- |
| D005-01 | Runtime Manager is deterministic execution infrastructure, not a manager agent |
| D005-02 | Workspace is durable; sandbox compute is disposable |
| D005-03 | Effective tool surface is produced by a Capability Broker per run |
| D005-04 | External/tool content is untrusted and cannot redefine authority |
| D005-05 | Context uses fixed authority-aware assembly order and reserved budgets |
| D005-06 | Memory is tiered; authoritative truth is separate from derived memory |
| D005-07 | Permanent memory writes require provenance/validation policy |
| D005-08 | Recovery recompiles fresh authoritative context and uses durable checkpoints |
| D005-09 | Model choice is runtime policy, not agent identity |
| D005-10 | A2A remote agents are bounded workers under internal AOP authority |
| D005-11 | MCP transports tool capabilities; organization state remains in AOP |
| D005-12 | Every run produces structured checkpoint/final reports for recovery and management compression |

## Outcome

The worker execution model is now specified deeply enough to implement an initial runtime adapter safely. Remaining planning work is concentrated in PoC product surface, deployment topology, testing/evaluation, observability UI, CI/CD, and an executable backlog with Definition of Done.

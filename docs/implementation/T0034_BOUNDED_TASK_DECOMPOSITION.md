# T0034 — Bounded Task Decomposition

Status: **PASS**

Slice: **3 — Intelligence Boundary**

## Purpose

T0034 gives a running Agent a bounded way to decompose its current Work Contract into child Tasks without giving the model direct authority over PostgreSQL, Organization scope, role assignment, artifact truth, or runtime lifecycle.

The first production consumer is the CTO Agent running through `runtime.openai`.

The authoritative path remains:

```text
OpenAI model output
  -> structured Runtime command proposal
  -> GatewayAgentCommandBridge
  -> CommandGateway
  -> Authorization / Policy
  -> TaskCreateHandler
  -> PostgreSQL domain transaction
  -> Event + Outbox
```

The model never receives Kernel database credentials and never writes Task rows directly.

## Command

Command type:

```text
task.create
```

Capability:

```text
task.create
```

The command target is the **currently executing parent Task**. `expectedRevision` is therefore the exact parent Task revision observed by the Runtime Context Manifest.

The model supplies only the proposed child Work Contract:

- child Task ID
- title and objective
- owner Agent
- reviewer Agent
- priority
- scope includes/excludes
- exact ArtifactVersion inputs
- deliverables
- acceptance criteria
- required capabilities
- constraints
- budget
- dependencies

The model does **not** choose the child Organization or Goal. The Kernel binds both from the parent execution.

Protocol implementation:

```text
packages/protocol/src/task-create-command.ts
```

## Same-Goal decomposition invariant

A child created through Runtime decomposition is always bound to:

```text
child.organizationId = parent.organizationId
child.goalId         = parent.goalId
```

This prevents a running model from expanding its authority into another Organization or Goal through its output payload.

## Live parent execution requirement

Task state alone is not sufficient authority to decompose.

`TaskCreateHandler` requires an authoritative live execution and follows the coordination lock order:

```text
Lease -> TaskRun -> Task
```

Before child creation, the Kernel verifies:

1. an active execution exists for the parent Task;
2. Lease, TaskRun and Task identities agree;
3. TaskRun status is `running`;
4. Lease status is `active`;
5. `Lease.expiresAt > now` even if the Lease Reaper has not yet processed it;
6. TaskRun Agent and Lease Agent both equal the command actor;
7. parent Task state is `running`;
8. parent Task owner equals the command actor;
9. parent Task revision equals command `expectedRevision`.

This closes the stale-runtime window where a provider could return after its Lease expired but before recovery changed the Lease status.

Handler:

```text
packages/command-bus/src/task-create.ts
```

## Child owner and reviewer validation

The protocol rejects owner/reviewer self-review before mutation.

The Kernel additionally verifies both Agents are:

- active Organization members;
- assigned at least one active Role at command time.

The child owner must satisfy every `requiredCapability` declared by the child Work Contract.

This prevents the CTO/model from assigning a Task to an unavailable or incapable Agent merely by naming its ID.

## Artifact input truth

`task.create` accepts exact `ArtifactVersion` references rather than ambiguous latest-artifact references.

For each proposed input, PostgreSQL resolves the authoritative Artifact and Version.

Invalid inputs are rejected atomically when they are:

- missing;
- not approved/superseded organizational truth;
- required but no longer the Artifact's current approved version.

This preserves the Slice 2 stale-input contract for AI-created Tasks.

## Dependency scope

Every dependency ID must already exist in the same Organization.

A new child cannot depend on itself and duplicate dependency IDs are rejected by protocol validation.

For initial creation, a full DAG cycle scan is unnecessary: the new child ID did not exist before the transaction, so no existing Task can already have a valid edge back to it. Future mutation commands that add edges to existing Tasks still require the full cycle invariant.

## Authoritative decomposition lineage

Migration:

```text
0015_task_decomposition.sql
```

adds:

```text
aop.task_decompositions
```

with authoritative relations:

```text
organization_id
parent_task_id
child_task_id
created_by_type
created_by_id
created_at
```

The relation gives Query/Observer/Audit code an explicit parent-child decomposition graph instead of hiding lineage in JSON constraints.

Each child can have one decomposition parent inside an Organization.

## Atomic persistence

`PostgresTaskCreateCommandTransaction` persists in the same Command Gateway transaction:

1. child Task;
2. exact Task Artifact inputs;
3. Task dependencies;
4. Task decomposition lineage;
5. `task.created` Event;
6. Outbox record;
7. command deduplication result.

Any rejection or persistence error rolls back the entire mutation.

Implementation:

```text
packages/database/src/postgres-task-create-command-store.ts
```

The Runtime-enabled store composes this transaction into the existing review/lifecycle transaction chain; there is no second Runtime-specific DB mutation path.

## Concurrency and idempotency

Child Task identity creation uses an Organization/Task advisory transaction lock before checking whether the ID exists.

Command Gateway idempotency ensures replay of the same Runtime proposal returns the existing command result without duplicating:

- child Task;
- decomposition relation;
- dependencies;
- Artifact inputs;
- Event;
- Outbox state.

Reads against one PostgreSQL transaction client are sequential. AOP does not use `Promise.all` to issue concurrent queries on the same `PoolClient`.

## Production Runtime exposure

After the PostgreSQL command gate passed, production worker wiring was expanded from:

```text
[task.submit_review]
```

to:

```text
[task.create, task.submit_review]
```

and `TaskCreateHandler` was registered in the production Command Gateway.

`task.submit_review` remains the required completion command for the parent Runtime execution. Creating child Tasks alone does not allow the parent Run to self-declare completion.

OpenAI Runtime dispatch remains opt-in through:

```text
RUNTIME_OPENAI_ENABLED=true
```

so this command exposure does not cause provider calls or API spending unless Runtime execution is explicitly enabled.

Production worker:

```text
apps/worker/src/main.ts
```

## PostgreSQL command gate

Named CI step:

```text
Validate bounded task.create decomposition against PostgreSQL
```

The integration suite verifies:

1. successful same-Goal child creation;
2. exact Artifact input persistence;
3. dependency persistence;
4. authoritative decomposition lineage;
5. idempotent replay with one Event/Outbox mutation;
6. stale required Artifact rejection with atomic rollback;
7. owner capability rejection;
8. inactive Role rejection;
9. active-status but time-expired Lease rejection;
10. cross-Organization dependency rejection;
11. stale parent revision rejection.

Test:

```text
packages/database/src/task-create.integration.test.ts
```

Core and live-execution hardening passed the full PostgreSQL regression chain in CI #322.

## OpenAI adapter -> Kernel -> PostgreSQL E2E

A dedicated integration test uses the real `OpenAIRuntimeAdapter` with an injected fake OpenAI transport. It performs no network call and needs no API key, while preserving the same structured-output boundary used in production.

Scenario:

```text
Parent Task READY rev 0
  -> scheduler task.claim
Parent LEASED rev 1
  -> Runtime prepare/start
Parent RUNNING rev 2
  -> exact Context Manifest(taskRevision=2)
  -> fake OpenAI structured result
       proposal 0: task.create
       proposal 1: task.submit_review
  -> Kernel accepts proposal 0
       child Backend Task READY rev 0
       same Goal
       Backend owner
       independent QA reviewer
       decomposition lineage persisted
  -> Kernel accepts proposal 1
       parent Task REVIEW rev 3
       pending QA Review created
  -> Runtime finish
       TaskRun SUCCEEDED
       Lease RELEASED
       immutable Runtime Run Report with two accepted command outcomes
```

The fake transport asserts that the OpenAI input contains:

- exact Context Manifest ID;
- running Task revision 2;
- parent Work Contract identity;
- explicit instruction that provider reasoning has no direct authority to mutate organizational state.

Test:

```text
apps/worker/src/cto-openai-decomposition.integration.test.ts
```

Named CI step:

```text
Validate CTO OpenAI decomposition control plane against PostgreSQL
```

CI #327 passed:

- workspace lint/typecheck/test/build;
- all prior PostgreSQL coordination/governance/Context/Runtime gates;
- bounded `task.create` command gate;
- Runtime Manager control-plane gate;
- CTO OpenAI decomposition control-plane gate.

## Invalid command safety evidence

The intelligence boundary is fail-closed at multiple layers.

Existing Runtime Manager tests prove a provider proposal such as `permission.grant` is not forwarded when it is outside `allowedCommandTypes`, recording:

```text
command_not_allowed_by_execution_policy
```

T0034 PostgreSQL tests independently prove that even an allowed `task.create` command is rejected by Kernel/domain invariants when its Artifact freshness, capability, Role, Organization scope, Lease or revision evidence is invalid.

Therefore `allowedCommandTypes` is only the first Runtime boundary; it does not replace Policy or domain validation.

## Exit result

T0034 satisfies the Slice 3 requirement that a CTO-class Agent can receive an exact Work Contract and emit bounded AOP Commands to decompose real work while all authoritative mutations remain controlled by the Kernel.

It does **not** authorize the model to:

- create arbitrary Organizations or Goals;
- grant permissions;
- bypass reviewer separation;
- assign incapable/inactive Agents;
- consume stale required Artifact truth;
- mutate DB directly;
- continue mutation after Lease expiry;
- mark the parent complete without the review workflow.

Next Slice 3 work should focus on repeatable organization bootstrap/scenario execution and broader real-model evidence, not on widening provider authority.
# T0028 — Runtime Manager Foundation

Status: **COMPLETE**

Date: 2026-08-25
Branch: `implementation/slice-3`
PR: #5 — Slice 3 — Intelligence Boundary

## Objective

Introduce the provider-neutral Runtime Manager without allowing provider/model code to bypass the AOP Kernel.

This ticket deliberately does **not** connect a real model yet. It first freezes and verifies the boundary through which future OpenAI/Claude/local/A2A adapters must execute.

## Core boundary

`@aop/runtime` depends on the AOP protocol but has no database dependency.

Provider adapters receive:

- trusted Organization/Run identity
- Agent definition
- exact persisted Context Manifest
- bounded execution policy

Provider adapters do not receive Kernel database credentials or an authoritative mutation API.

## Runtime adapter contract

Implemented provider-neutral methods:

- `prepare`
- `start`
- `cancel`
- `inspect`

Prepared/runtime results carry:

- runtime ID
- adapter/provider/model metadata
- usage counters
- trace references
- structured failure reason
- bounded command proposals

## Command proposal boundary

Runtime/model output does not create a complete `CommandEnvelope`.

A runtime may only propose:

- command type
- optional target
- optional expected revision
- payload

It cannot choose:

- actor identity
- organization identity
- command ID
- protocol/schema version
- idempotency key

Trusted identity is attached outside provider code before the proposal reaches the Kernel.

## Runtime Manager execution path

1. validate execution policy and context budget
2. obtain exact Context Manifest
3. verify Manifest Organization/Run/Agent/Manifest identity
4. call adapter `prepare`
5. persist prepared/running lifecycle through trusted `KernelRuntimePort`
6. call adapter `start`
7. validate provider-reported usage
8. fail closed on tool/output budget violation
9. filter proposals against execution-policy command allowlist
10. forward allowed proposals with trusted Organization/Run/Agent/proposal index
11. normalize adapter or Kernel-submission failures
12. persist finished state through trusted control-plane port
13. return structured `RuntimeRunReport`

## Failure safety

- Manifest identity mismatch stops before provider preparation.
- Provider exceptions become a structured failed Run report.
- Usage overrun suppresses all command forwarding.
- A proposal outside the allowlist is not sent to Kernel.
- Kernel proposal-submission failure fails the Run and stops forwarding subsequent proposals.
- If trusted prepared/running lifecycle persistence fails after provider preparation, Runtime Manager best-effort cancels the provider runtime and does not start it.

## Runtime control operations

Runtime Manager exposes bounded:

- heartbeat -> trusted Kernel port
- cancel -> provider cancel + trusted Kernel finished record
- inspect -> adapter inspection

The actual PostgreSQL lifecycle implementation remains a trusted Kernel concern and is not embedded in provider/runtime code.

## Machine-verifiable evidence

`packages/runtime/src/runtime-manager.test.ts` covers:

1. exact Context Manifest reaches provider adapter
2. trusted command identity is bound outside provider output
3. out-of-policy command proposal is denied locally
4. Context identity mismatch blocks provider preparation
5. provider exception -> failed Run
6. output/tool budget overrun -> fail closed, no commands forwarded
7. Kernel command-submission failure -> failed Run and later proposals stopped
8. trusted lifecycle failure -> prepared provider runtime cancelled before start
9. heartbeat/cancel routed through trusted control-plane ports

The foundation initially passed CI #221. A subsequent security hardening introduced proposal-index binding and fail-closed Kernel submission; the regression expectation was updated and all Runtime Manager tests passed in CI #223.

## CI evidence

GitHub Actions CI run: **#223** (`32870038240`)

Result: **SUCCESS**

Workspace:

- lint PASS
- typecheck PASS
- tests PASS
- build PASS

PostgreSQL:

- all existing Kernel, Coordination, Organizational Truth and Context Manifest gates PASS

## Verdict

**T0028 COMPLETE.**

The Runtime Manager boundary is now provider-neutral and fail-closed. The next work is T0029: bind runtime proposals to the real Command Gateway using trusted deterministic command identity, then implement authoritative TaskRun lifecycle/Run Report persistence before connecting the first real CTO model.

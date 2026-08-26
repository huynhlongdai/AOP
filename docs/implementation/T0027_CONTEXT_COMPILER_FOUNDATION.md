# T0027 — Context Compiler Foundation

Status: **COMPLETE**

Date: 2026-08-25
Branch: `implementation/slice-3`
PR: #5 — Slice 3 — Intelligence Boundary

## Objective

Create an exact, reproducible Context Manifest for one concrete TaskRun from authoritative organizational state before any real model/runtime is allowed to execute.

The compiler must preserve the AOP boundary:

- organizational truth comes from Kernel state, not model memory
- authority cannot be introduced by untrusted context
- mandatory truth cannot be silently dropped to satisfy a token budget
- a TaskRun receives one immutable initial Context Manifest
- changed authoritative truth requires a new Run/retry rather than silently changing prompt context mid-run

## Protocol hardening

`ContextFragment` now carries the exact canonical `content` delivered to a runtime plus a mandatory SHA-256 `digest` of that content.

Added mandatory fragment kind:

- `authority`

Mandatory Context classes are now:

- policy
- identity
- role
- authority
- goal
- task
- output_contract

Untrusted fragments must have authority weight `0`.

## Pure Context Compiler

Implemented in `@aop/context-engine`:

- canonical JSON serialization with deterministic object-key ordering
- SHA-256 digest generation
- deterministic token estimation
- unique fragment-key enforcement
- deterministic final ordering
- mandatory-fragment preservation
- deterministic optional-fragment selection by authority/relevance
- hard failure when mandatory context exceeds the token budget
- protocol validation on final Context Manifest

## PostgreSQL persistence and integrity

Migration `0012_context_manifest_integrity.sql` adds:

- `schema_version`
- `protocol_version`
- one Context Manifest per TaskRun
- pre-execution-only insertion
- current Task revision validation
- required-fragment validation
- fragment-shape validation
- token-total validation
- untrusted-authority defense-in-depth

## PostgreSQL resolver/store

Implemented `PostgresContextManifestStore`.

Compilation uses an advisory lock per `(organization, run)` before opening a `REPEATABLE READ` transaction. A concurrent compiler waits, gets a fresh snapshot after the first commit, and returns the existing immutable Manifest.

The resolver loads and verifies:

1. TaskRun identity and pre-execution status
2. Task and exact Task revision
3. Organization active state
4. Agent identity
5. active Organization membership
6. active Role assignments
7. Role authority
8. non-expired explicit Permissions
9. Goal
10. Task dependencies
11. all active Decisions (conservative v0.1 policy)
12. Artifact inputs and exact versions
13. previous TaskRun attempt, when present
14. Task output contract and budget

Required Artifact inputs that are stale or no longer the current approved version block Context compilation.

Task ownership is rechecked at compilation time: the TaskRun agent must still own the Task.

## Security boundary

The compiler persists authority as an explicit authoritative fragment.

No derived or untrusted fragment may expand authority. The runtime is expected to receive the compiled Manifest and bounded command/tool capabilities, not database credentials.

## Machine-verifiable evidence

Pure compiler tests cover:

- canonical hashing
- stable exact Manifest generation
- mandatory-budget failure
- deterministic optional selection
- duplicate fragment-key rejection

PostgreSQL integration suite covers:

1. authoritative state -> exact persisted Context Manifest
2. concurrent compilation -> one immutable Manifest
3. stale required Artifact -> compilation denied
4. missing active Role -> compilation denied
5. mandatory context over budget -> fail instead of truncate
6. direct SQL malformed Manifest -> database rejection

CI gate:

`Validate exact Context Manifest compilation against PostgreSQL`

## CI evidence

GitHub Actions CI run: **#215** (`32868868972`)

Result: **SUCCESS**

Workspace:

- lint PASS
- typecheck PASS
- tests PASS
- build PASS

PostgreSQL:

- all prior Kernel/Coordination/Organizational Truth gates PASS
- Context Manifest compilation gate PASS

## Verdict

**T0027 COMPLETE.**

AOP now has a deterministic, persisted Intelligence Boundary input contract. The next ticket is T0028 Runtime Manager Foundation. No real model is connected until the Runtime Manager proves it cannot bypass the Kernel and can only return bounded outputs/commands with traceable usage.

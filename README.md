# AOP — Agent Organization Protocol

**Status: Gate D passed — Slice 2 Organizational Truth complete; entering Slice 3 Intelligence Boundary**

**UX/UI status: v0.1 FROZEN for PoC implementation — React transfer plan approved**

AOP is an experimental protocol and runtime architecture for organizing autonomous AI workers into persistent teams, companies, and organizations.

The project started from a broader Agent Marketplace vision: agents should not be isolated chatbots or prompt packages. An agent should have identity, role, capabilities, skills, tools, memory, permissions, work history, and measurable performance. Agents should be able to operate independently or be hired into teams and companies under AI or human management.

The central research question is harder than creating agents: **how can many agents coordinate, divide work, report, share authoritative state, recover from failure, and produce coherent verified output without a human continuously mediating between them?**

## Core thesis

AOP treats an AI organization as a distributed system.

- Agent = worker/node
- Organization Kernel = authoritative control plane
- Goal/Task graph = work graph
- Artifact = durable work output
- Decision = authoritative organizational choice
- Event = immutable history
- Lease = execution ownership
- Permission = bounded authority
- Context Compiler = selective context assembly
- A2A = remote agent interoperability
- MCP = tool/data interoperability

> **Dumb Kernel, Smart Agents. Shared truth, selective memory.**

## Start here

1. `docs/history/000-origin-and-pre-meeting-discussion.md`
2. `docs/protocol/AOP-v0.1.md`
3. `docs/architecture/system-architecture-v0.1.md`
4. `docs/implementation/MASTER_IMPLEMENTATION_PLAN.md`
5. `docs/implementation/SLICE0_GATE_A_CHECKPOINT.md`
6. `docs/implementation/SLICE1_GATE_B_CHECKPOINT.md`
7. `docs/implementation/SLICE2_GATE_D_CHECKPOINT.md`
8. `docs/implementation/T0021_ARTIFACT_WRITE_PATH.md`
9. `docs/implementation/T0022_ARTIFACT_REVIEW_APPROVAL.md`
10. `docs/implementation/T0023_ARTIFACT_CONSUMER_INVALIDATION.md`
11. `docs/implementation/T0024_TASK_QA_REVIEW_REWORK.md`
12. `docs/implementation/T0025_DECISION_AUTHORITY_SUPERSESSION.md`
13. `docs/implementation/T0026_VERIFIED_REPORTING.md`
14. `docs/design/UX_UI_SYSTEM_v0.1.md`
15. `docs/implementation/UI_IMPLEMENTATION_PLAN.md`
16. `docs/implementation/REACT_TRANSFER_PLAN.md`
17. `prototype/README.md`

## Meeting record

1. `docs/meetings/001-organization-kernel-and-coordination.md`
2. `docs/meetings/002-aop-v0.1-protocol.md`
3. `docs/meetings/003-implementation-design.md`
4. `docs/meetings/004-domain-database-command-api.md`
5. `docs/meetings/005-runtime-context-memory-recovery.md`
6. `docs/meetings/006-poc-product-deployment-evaluation.md`
7. `docs/meetings/007-execution-readiness-review.md`
8. `docs/meetings/008-ux-ui-alignment.md`
9. `docs/meetings/009-frontend-prototype-kickoff.md`
10. `docs/meetings/010-truth-automation-attention-ux.md`
11. `docs/meetings/011-ux-stress-scale-navigation.md`
12. `docs/meetings/012-ux-freeze-react-transfer.md`
13. `docs/meetings/013-slice2-company-review-decision-governance.md`

Meeting #007 formally closed speculative architecture planning. Later meetings refine product/UX or respond to implementation evidence rather than reopening the Kernel without evidence.

Meetings #008–#012 established, prototyped, stress-tested and finally froze the UX/UI contract for the PoC. Meeting #013 audited real repository/CI state, completed Decision governance evidence and fixed the execution order through the Slice 2 Gate D review.

## Current PoC target

```text
Founder
   |
  CEO
   |
  CTO
 / | \
BE FE QA
```

The PoC must autonomously plan, decompose, assign, execute, produce artifacts, review, rework, integrate, test, report verified state, and recover from injected failures.

## Product UX thesis

AOP is designed as an **AI Organization Operating System**, not primarily as a chatbot, kanban application, or workflow builder.

The UI is organized around four layers:

- Executive — health, goals, approvals, risks, verified progress
- Work — projects, tasks, runs, reviews, blockers
- Workforce — agents, teams, roles, capabilities, permissions
- Truth/Automation/Audit — artifacts, decisions, schedules, events, memory

> **State over conversation. Evidence over self-report. Exceptions over noise.**

At organizational scale, the UX adds:

- hierarchical context narrowing instead of menu explosion
- deterministic/ranked Human Attention
- Search + Command Palette for cross-object navigation
- saved views / aggregation / density controls for high-volume lists
- progressive disclosure from executive summary -> operational evidence -> diagnostic detail
- explicit drill-up paths from deep detail pages

## Prototype status

The `prototype/` directory contains a zero-build clickable prototype covering:

- Executive Dashboard
- Project Workspace
- Task Board + Task Detail
- Agent Directory + Agent Detail
- Artifact Registry + Artifact Detail
- Decision Registry + Decision Detail
- Human Approval Center + Approval Detail
- Schedule/Cron + Schedule Detail
- Event Explorer + Event Detail
- Knowledge/Memory boundary overview
- Command Palette
- ranked Human Attention drawer
- hierarchical context switcher
- 12 / 120 / 1,200-agent scale fixtures

The prototype intentionally uses mock domain data while preserving legitimate AOP semantics. It is an interaction validation layer, not a second source of truth. Feature expansion is frozen after Meeting #012 unless implementation/usability evidence requires a focused experiment.

## UX implementation contract

The production React client must preserve:

- organization-scoped canonical routes
- shared DetailShell / ContextRail grammar
- Snapshot + ordered SSE + reconciliation realtime behavior
- explicit stale/reconnecting states
- no optimistic authoritative lifecycle mutations
- command result / event reconciliation for protected actions
- accessibility baseline
- scale-aware pagination/virtualization/aggregation

See `docs/implementation/REACT_TRANSFER_PLAN.md`.

## Execution slices

- Slice 0 — Deterministic Kernel — **Gate A passed**
- Slice 1 — Coordination Engine — **Gate B passed**
- Slice 2 — Organizational Truth — **Gate D passed**
- Slice 3 — Intelligence Boundary — **NEXT**
- Slice 4 — Real Work Environment
- Slice 5 — Product PoC
- Slice 6 — Comparative Validation

## Current implementation checkpoint

Completed through `T0026 — Verified Organizational Reporting`.

The deterministic substrate now includes:

- authoritative PostgreSQL organization state
- Command -> Policy -> Domain -> Transaction -> Event/Outbox mutation path
- optimistic revision and idempotency fencing
- authoritative Query API + resumable ordered SSE
- durable Outbox delivery and stale-worker recovery
- deterministic Task readiness and Scheduler claims
- TaskRun / Lease execution ownership
- heartbeat revision fencing and lost-run recovery
- immutable/versioned Artifact write and approval path
- Artifact lineage and Task consumer tracking
- derived stale-input truth with Scheduler/claim protection
- QA Review/Rework as a completion gate
- PostgreSQL defense-in-depth against invalid Task completion
- Decision-specific authority and atomic supersession
- deterministic verified reporting from one repeatable-read snapshot
- historical completion separated from currently verified completion
- explicit governance blockers separated from general human attention

See `docs/implementation/SLICE2_GATE_D_CHECKPOINT.md` for the consolidated evidence.

## Immediate next engineering focus

**Slice 3 — Intelligence Boundary (E09–E10)**

Implement and prove:

1. Context Compiler resolvers and exact persisted Context Manifest
2. mandatory identity/role/authority/goal/task/Decision/Artifact fragments
3. trust classification so untrusted evidence cannot redefine authority
4. deterministic token/context budgeting without silently dropping mandatory fragments
5. Runtime Manager contract and first bounded runtime adapter
6. one real CTO agent receiving an exact Work Contract
7. agent output limited to valid AOP Commands through the Kernel gateway
8. invalid agent commands denied safely
9. traceable run/model/tool usage
10. no direct runtime/sandbox PostgreSQL mutation capability

The next phase is the first controlled connection of model intelligence to the already-verified deterministic organization substrate. Marketplace expansion remains a non-goal until the PoC and comparative evaluation justify it.

## PoC non-goals

- public Marketplace UI
- token economy
- reputation economy
- large-scale microservices
- hundreds of agents in the first functional PoC

The first objective is to prove that the Organization Kernel improves verified autonomous work compared with a single-agent baseline and a simple supervisor multi-agent baseline.

# AOP — Agent Organization Protocol

**Status: Gate B passed — Slice 1 Coordination Engine complete; entering Slice 2 Organizational Truth**

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
7. `docs/implementation/T0020_SCHEDULER_READINESS_LEASE.md`
8. `docs/design/UX_UI_SYSTEM_v0.1.md`
9. `docs/implementation/UI_IMPLEMENTATION_PLAN.md`
10. `docs/implementation/REACT_TRANSFER_PLAN.md`
11. `prototype/README.md`

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

Meeting #007 formally closed speculative architecture planning. Later meetings refine product/UX or respond to implementation evidence rather than reopening the Kernel without evidence.

Meetings #008–#012 established, prototyped, stress-tested and finally froze the UX/UI contract for the PoC. The zero-build prototype remains a reference artifact; production transfer is governed by `docs/implementation/REACT_TRANSFER_PLAN.md`.

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
- Slice 2 — Organizational Truth — **NEXT**
- Slice 3 — Intelligence Boundary
- Slice 4 — Real Work Environment
- Slice 5 — Product PoC
- Slice 6 — Comparative Validation

## Current implementation checkpoint

Completed through `T0020 — Scheduler / Readiness / Lease Coordination`.

The deterministic substrate now includes:

- authoritative PostgreSQL state
- Command -> Policy -> Domain -> Transaction -> Event/Outbox mutation path
- optimistic revision and idempotency fencing
- authoritative Query API + resumable ordered SSE
- durable Outbox delivery and stale-worker recovery
- deterministic Task readiness and Scheduler claims
- TaskRun / Lease execution ownership
- heartbeat revision fencing
- expired-Lease recovery to lost Run + READY Task
- next-attempt failover without manual database repair

See `docs/implementation/SLICE1_GATE_B_CHECKPOINT.md` for evidence.

## Immediate next engineering focus

**Slice 2 — Organizational Truth (E07–E08)**

Implement production vertical slices for:

1. Artifact publish/version semantics
2. Artifact lineage and consumers
3. breaking-version impact analysis and stale-work detection
4. Decision authority, activation and supersession
5. Review/rejection/rework control of Task completion
6. verified Reporting Engine

The next project phase remains engineering execution, not speculative UX expansion or Marketplace work.

## PoC non-goals

- public Marketplace UI
- token economy
- reputation economy
- large-scale microservices
- hundreds of agents in the first functional PoC

The first objective is to prove that the Organization Kernel improves verified autonomous work compared with a single-agent baseline and a simple supervisor multi-agent baseline.

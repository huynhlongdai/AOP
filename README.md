# AOP — Agent Organization Protocol

**Status: Planning complete — Ready for Slice 0 implementation**

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

## Meeting record

1. `docs/meetings/001-organization-kernel-and-coordination.md`
2. `docs/meetings/002-aop-v0.1-protocol.md`
3. `docs/meetings/003-implementation-design.md`
4. `docs/meetings/004-domain-database-command-api.md`
5. `docs/meetings/005-runtime-context-memory-recovery.md`
6. `docs/meetings/006-poc-product-deployment-evaluation.md`
7. `docs/meetings/007-execution-readiness-review.md`

Meeting #007 formally closed speculative planning. Future architecture meetings should be triggered by implementation evidence, failed gates, or ADR-worthy cross-cutting decisions.

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

## Execution slices

- Slice 0 — Deterministic Kernel
- Slice 1 — Coordination Engine
- Slice 2 — Organizational Truth
- Slice 3 — Intelligence Boundary
- Slice 4 — Real Work Environment
- Slice 5 — Product PoC
- Slice 6 — Comparative Validation

## Immediate next ticket

`T0001 — Initialize monorepo`

See `docs/implementation/MASTER_IMPLEMENTATION_PLAN.md` for the complete dependency graph, epics, tickets, acceptance criteria, security requirements, chaos tests, and go/no-go gates.

## PoC non-goals

- public Marketplace UI
- token economy
- reputation economy
- large-scale microservices
- hundreds of agents

The first objective is to prove that the Organization Kernel improves verified autonomous work compared with a single-agent baseline and a simple supervisor multi-agent baseline.

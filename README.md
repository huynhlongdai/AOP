# AOP — Agent Organization Protocol

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

## Documentation

- `docs/history/` — origin, earlier discussion, and project evolution
- `docs/meetings/` — meeting records and decisions
- `docs/architecture/` — architecture specifications
- `docs/protocol/` — AOP protocol definitions
- `docs/implementation/` — implementation roadmap and sprint plan
- `docs/adr/` — architecture decision records

## Meeting index

1. Meeting #001 — Organization Kernel and coordination thesis
2. Meeting #002 — AOP v0.1 protocol primitives
3. Meeting #003 — implementation architecture
4. Subsequent meetings continue until the implementation plan is execution-ready.

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

The PoC must autonomously plan, decompose, assign, execute, produce artifacts, review, rework, integrate, test, report, and recover from injected failures.

## PoC non-goals

- Marketplace UI
- Token economy
- Reputation economy
- Large-scale microservices
- Hundreds of agents

The first objective is to prove that the Organization Kernel improves verified autonomous work compared with a single-agent baseline and a simple supervisor multi-agent baseline.

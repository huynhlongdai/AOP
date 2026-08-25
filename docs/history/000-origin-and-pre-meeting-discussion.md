# AOP Origin and Pre-Meeting Discussion

Date: 2026-08-25

## Original founder idea

The project began from a vision for an Agent Market in which each agent is comparable to a persistent digital worker rather than a prompt. Each agent should have:

- identity and personality
- role and responsibilities
- knowledge and libraries
- skills
- tools
- memory
- permissions
- work history
- measurable performance
- pricing/economics in a later marketplace layer

The founder should be able to describe an idea such as a software product and ask an assistant to form a company, recruit a CEO, and allow that CEO to recruit the required AI workforce. Agents may operate independently or collaborate in teams, departments, companies, or organizations under AI or human management.

The long-term product vision includes an Agent Marketplace, Skill Marketplace, Company Templates, Knowledge Packs, Tool Connectors, evaluation/reputation, and eventually machine-to-machine services. However, discussion quickly identified that marketplace distribution is not the hardest technical problem.

## Core problem discovered

The hardest problem is **organizational coordination**.

A group of agents cannot simply be placed in a shared chat and expected to behave like a company. At scale this creates:

- duplicate work
- contradictory decisions
- stale context
- context/token explosion
- circular discussion
- agents changing scope without authority
- race conditions
- conflicting writes
- hidden dependencies
- inaccurate progress reports
- partial failure and difficult recovery

The key architectural principle that emerged was:

> **Agents should not coordinate primarily through chat. They should coordinate through state, contracts, events, and artifacts.**

Chat remains useful for questions, clarification, negotiation, and discussion, but it is not authoritative organizational state.

## Organization Kernel concept

The system therefore requires an Organization Kernel that is the source of truth for the company.

The Kernel manages:

- organization structure
- goals
- roles and authority
- task graph
- task ownership
- dependencies
- artifact versions
- decisions
- permissions
- execution leases
- reviews
- events
- approvals
- budgets/policies in later stages

Agents are workers around this authoritative core, not the source of truth themselves.

## Task as work contract

Every meaningful unit of work should become a structured task/work contract with fields such as:

- objective
- owner
- requester
- scope
- dependencies
- required inputs
- required outputs
- acceptance criteria
- constraints
- permissions
- budget
- review policy

Tasks form a dependency DAG. A downstream task should remain blocked until hard dependencies and required authoritative inputs are ready.

## Artifact-based collaboration

Agents should hand off durable artifacts rather than long conversational histories. Examples:

- PRD
- architecture document
- ADR/decision record
- API specification
- database schema
- source commit
- test report
- deployment report

Artifacts are immutable by version. A change creates a new version instead of silently overwriting the old one. The system can then identify tasks that consume stale inputs and run impact analysis.

## Event-driven synchronization

Important organizational mutations produce events such as:

- TASK_CREATED
- TASK_READY
- TASK_STARTED
- TASK_BLOCKED
- TASK_COMPLETED
- ARTIFACT_CREATED
- ARTIFACT_VERSION_CREATED
- DECISION_APPROVED
- REVIEW_FAILED
- LEASE_EXPIRED

Events are used for synchronization and audit. Context should be routed only to relevant agents rather than broadcast to the entire organization.

## Shared truth vs shared memory

A major distinction was established:

> **Shared truth is more important than shared memory.**

Authoritative state includes tasks, decisions, artifact versions, ownership, permissions, goals, and events. This belongs in a transactional state store.

Memory is derived intelligence that supports reasoning. It may include episodic memory, semantic memory, project knowledge, team knowledge, relationship memory, and prior experience. Memory must never override current authoritative state.

## Context Compiler

Before an agent executes a task, a Context Compiler should assemble only the relevant context:

1. identity
2. role and authority
3. organization mission
4. goal
5. task contract
6. active dependencies
7. required artifact versions
8. active decisions
9. previous attempts
10. relevant memory
11. allowed tools/capabilities
12. output contract

Authority, freshness, relevance, scope, dependencies, permissions, and token budget determine inclusion. Mandatory authoritative context must never be dropped merely because semantic retrieval ranks something else more highly.

## Management hierarchy as information compression

Organization hierarchy is not only about delegation. It is also an information compression mechanism.

Commands move downward:

Goal -> objective -> project -> task -> action

Information moves upward:

Action -> result -> task report -> team status -> executive summary

A founder should see verified progress, risks, blockers, pending decisions, and approvals instead of thousands of raw agent events.

## Deterministic system vs AI reasoning

The organization must explicitly separate deterministic responsibilities from LLM reasoning.

Deterministic Kernel responsibilities:

- state transitions
- permissions
- leases
- transactions
- dependency checks
- versioning
- event ordering
- validation
- idempotency
- approvals

Agent/LLM responsibilities:

- planning
- decomposition
- research
- reasoning
- code generation
- analysis
- prioritization proposals
- summarization
- negotiation

Hybrid areas such as hiring, assignment, review, and conflict resolution may be proposed by agents but validated and bounded by policy.

## Governance and bounded autonomy

Autonomy is not unlimited authority. Agents receive capabilities rather than raw unrestricted credentials. Examples:

- engineer may create a branch and open a PR but cannot force-push main
- CTO may approve architecture but cannot delete the company
- production deployment may require human approval
- hiring authority may be bounded by role and headcount/budget limits

## Distributed-systems analogy

The project treats an AI company like a distributed system:

| Distributed systems | AI organization |
| --- | --- |
| Node | Agent |
| Scheduler | Task orchestrator |
| Message queue | Event bus |
| Database | Shared authoritative state |
| API contract | Agent/work contract |
| Service registry | Agent registry |
| RBAC/capabilities | Agent permissions |
| Logs/traces | Organization/agent traces |
| Version control | Artifact versions |
| Consensus/governance | Decision process |
| Deadlock | Agents waiting on each other |
| Race condition | Agents modifying the same resource |

This reframed AOP from a prompt-engineering problem into a combination of distributed systems, organizational design, and AI reasoning.

## Product reframing

The initial thesis evolved:

Agent Marketplace -> AI Organization OS -> Organization Kernel -> Organization Protocol.

Marketplace remains a future distribution/economy layer. The first technical objective is to prove that a small AI company can coordinate verified autonomous work better than simpler baselines.

## First PoC agreed

A five-agent software company:

```text
Founder
   |
  CEO
   |
  CTO
 / | \
BE FE QA
```

The company should be able to:

- understand a founder objective
- plan
- decompose work
- assign tasks
- produce artifacts
- coordinate contracts
- implement
- review/reject/rework
- integrate
- test
- report verified status
- recover from agent/runtime failure
- respond to requirement changes

The system must later be benchmarked against:

1. a single strong agent
2. a simple supervisor multi-agent system
3. the AOP Organization Kernel

This document records the conceptual discussion that preceded the formal company meetings.

# Founding Company Meeting #001 — Organization Kernel and Coordination

Date: 2026-08-25

## Participants

- Chief of Staff
- CEO
- CTO
- Chief Architect
- Head of Agent Research
- CPO
- Head of Data
- SRE / FinOps
- Security & Governance
- Marketplace Lead
- QA Lead

## Meeting question

If a founder says **“build product X”**, can the system form a company containing CEO -> CTO -> PM/Engineers/QA and allow it to operate for hours or days without degrading into a group-chat failure mode?

The meeting answer was: not with a conventional multi-agent chat architecture.

## D001 — Agent reasoning must not be infrastructure

Agents may decide what ought to happen, but software must deterministically manage:

- task ownership
- task state
- active artifact versions
- organization authority
- resource ownership
- budgets
- dependencies
- approvals
- durable state

LLM reasoning must not be the source of truth for infrastructure.

## Three-plane architecture

### Control Plane

Owns the organization:

- organization structure
- roles
- goals
- task graph
- policies
- permissions
- budgets
- scheduling

### Data Plane

Owns durable truth and knowledge:

- artifacts
- decisions
- events
- company/project knowledge
- memory indexes
- Git/files/databases

### Execution Plane

Runs workers:

- agent runtime
- sandbox
- browser
- shell
- MCP tools
- models
- external agents

Critical invariant:

> **Company lifetime is greater than agent-runtime lifetime.**

A runtime may disappear and be recreated while organization state remains valid.

## D002 — Shared truth over shared memory

Using one large vector database as “shared memory” is insufficient and unsafe. Semantic retrieval can return obsolete discussion and cause agents to confuse proposals with active decisions.

Transactional authoritative state must contain:

- current goals
- task states
- ownership
- active decisions
- approved artifact versions
- permissions
- events

Memory is selective derived intelligence and cannot override authoritative state.

## Context Compiler

The Context Compiler became a central subsystem. Before a worker runs, it assembles:

- identity
- role
- objective
- task contract
- relevant architecture
- active decisions
- required artifact versions
- prior attempts
- dependencies
- permissions
- expected outputs

Selection factors:

- authority
- freshness
- relevance
- dependency relationship
- scope
- permissions
- token cost

The system should route relevant context, not broadcast all company history.

## Organization lifecycle

An organization is a dynamic graph rather than a fixed workflow:

```text
FORMATION
   ↓
PLANNING
   ↓
STAFFING
   ↓
EXECUTION
   ↓
REVIEW
   ↓
ADAPTATION
   ↓
DELIVERY
   ↓
LEARNING
   ↺
```

The organization may move back into staffing when a capability gap is discovered.

## Work Contract

A task is not merely a title. A work contract should define:

- objective
- scope
- owner
- inputs
- dependencies
- constraints
- permissions
- deliverables
- acceptance criteria
- budget
- deadline
- review policy

## Lease-based execution

Task assignment alone is insufficient in a distributed runtime. A worker should acquire an execution lease and heartbeat it. If the worker disappears and the lease expires, the task becomes available for another run.

This prevents a dead runtime from permanently owning work and reduces duplicate execution.

## Idempotency

External and organizational actions should support idempotency keys where possible. A retry after a timeout must not create duplicate issues, artifacts, commits, or other side effects.

## Event history

Important state changes generate append-only events, enabling:

- audit
- debugging
- replay/reconstruction
- analytics
- performance scoring
- organizational memory

Example history:

```text
08:01 CEO created GOAL-12
08:03 CTO created TASK-28
08:07 Architect published ARCH-03
08:08 TASK-31 became ready
08:17 Backend started TASK-31
08:42 Backend produced COMMIT-A72
08:44 QA rejected TASK-31
08:58 Backend produced COMMIT-A91
09:04 QA approved TASK-31
```

## Zero-trust workers

Agents should receive bounded capabilities instead of raw unrestricted credentials.

Example GitHub policy:

- repository read: allowed
- create branch: allowed
- commit own branch: allowed
- open PR: allowed
- merge main: approval/role dependent
- delete repository: denied

Reasoning may be autonomous, but authority is bounded.

## A2A and MCP position

The project should not reinvent lower-level interoperability.

- MCP: Agent <-> tool/data interoperability
- A2A: Agent <-> remote agent interoperability
- AOP: organizational semantics above those protocols

AOP must define concepts that A2A/MCP do not inherently solve, including organization, role, authority, goal, work contract, dependency, decision, review, lease, policy, and budget.

## Structured meetings

Agent meetings must not become unlimited group chat. A meeting should have purpose, participants, inputs, agenda, turn budget, and required outputs.

A useful meeting creates organizational state such as:

- Decision
- Task
- Artifact
- Risk
- Question
- Escalation

Conversation without a state transition is considered operational waste.

## Management compression

Hierarchy has two simultaneous functions:

1. distribute authority/work downward
2. compress information upward

Workers may generate hundreds of low-level events. Team leads reduce them to meaningful changes, executives reduce those further, and the founder receives a small verified management view.

## Multi-agent benchmark requirement

The project must not assume more agents are better.

The same task must be tested under:

- Mode A: single strong agent
- Mode B: fixed/simple supervisor multi-agent
- Mode C: AOP organization

Metrics:

- task success
- tests passed
- human interventions
- cost
- wall-clock time
- duplicate work
- contradictions
- context errors
- crash recovery
- requirement-change recovery

If AOP does not beat simpler architectures on sufficiently complex tasks, there is no defensible product thesis.

## Deterministic vs agent responsibilities

### Deterministic system

- task state
- permissions
- leases
- transactions
- budgets
- versions
- events
- dependencies
- locks/concurrency
- validation

### Agent reasoning

- planning
- decomposition
- research
- prioritization proposals
- code generation
- analysis
- summaries
- negotiation

### Hybrid

- hiring
- review
- assignment
- conflict resolution

Agents may propose; policy determines whether an action is permitted.

## Architecture emerging from meeting

```text
Founder
  |
Executive Assistant
  |
Organization Kernel
  |-- Goal Engine
  |-- Org Graph
  |-- Task Graph
  |-- Policy Engine
  |-- Scheduler
  |-- Budget Engine
  |-- Decision Registry
  |-- Artifact Registry
  `-- Event Log
  |
Context Engine
  |
Agent Fabric (OpenAI / Claude / Gemini / Local / A2A)
  |
Tool Fabric (MCP)
```

## Decision register

| ID | Decision |
| --- | --- |
| D001 | Agent reasoning does not manage infrastructure |
| D002 | Shared truth is more important than shared memory |
| D003 | Autonomous reasoning does not imply unlimited authority |
| D004 | Organization is persistent; agent runtime is disposable |
| D005 | Communication should produce state/artifacts, not only conversation |
| D006 | Context is compiled per task rather than broadcast |
| D007 | Hierarchy distributes authority and compresses information |
| D008 | Reuse A2A/MCP rather than invent lower-level transport |
| D009 | AOP is an organizational-semantics layer above A2A/MCP |
| D010 | Benchmark must prove value over single-agent/simple supervisor |
| D011 | Build Software Company PoC before Marketplace |

## PoC agreed

```text
Founder
   |
  CEO
   |
  CTO
 / | \
BE FE QA
```

The first proof is not a marketplace. It is a small software company that can plan, coordinate via artifacts, handle changing requirements, integrate, test, report verified status, and recover from failures with minimal founder intervention.

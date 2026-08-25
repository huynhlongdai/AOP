# Founding Company Meeting #010 — Truth, Automation & Attention UX

Date: 2026-08-25
Status: Approved for prototype implementation

## Purpose

Complete the remaining high-priority AOP observer/control surfaces after Meeting #009. The meeting focuses on Artifact, Decision, Approval, Schedule/Cron, and Event UX and how these modules connect back to authoritative organization state.

## Participants

- Founder representative
- Chief of Staff
- CEO
- CPO
- UX Lead
- Product Designer
- CTO
- Platform Architect
- Agent Systems Architect
- SRE/Observability Lead
- Security/Governance Lead
- QA/Evaluation Lead

## Opening constraint

These screens must not become five isolated admin products. They must use the shared AOP detail-shell, shared status vocabulary, deep links, organization/project context, and one attention model.

> State over conversation. Evidence over self-report. Exceptions over noise.

## Discussion 1 — Artifact UX

Artifacts are not generic files. They are durable outputs with identity, immutable versions, provenance, approval state, consumers, and lineage.

### Required Artifact Registry fields

- logical artifact identity
- current approved version
- type/schema
- producer agent/task
- status
- consumers
- stale/impact indicators
- last authoritative update

### Artifact Detail sections

- identity/status/current approved version
- version history
- provenance
- lineage graph
- task consumers
- impacted work
- approval/review state
- discussion
- ordered events
- preview/raw representation

### Decision UX-010-01

Artifact version history and lineage are first-class. A file-browser metaphor alone is rejected.

---

## Discussion 2 — Decision Registry

A decision is an authoritative organizational object, not a conclusion buried in chat.

### Decision Registry states

- PROPOSED
- APPROVAL_PENDING
- ACTIVE
- SUPERSEDED
- REJECTED

### Decision Detail must show

- question
- options considered
- selected option
- rationale
- scope
- authority required
- proposer
- approver
- effective date
- affected tasks
- affected artifacts
- downstream impact
- linked discussion
- event history

### Decision UX-010-02

Conversation may propose a decision, but only an approved Decision object changes authoritative organizational truth.

---

## Discussion 3 — Approval Center

The team rejects treating approvals as notifications only. Approval is a durable workflow and the main human intervention surface in an autonomous organization.

### Approval Inbox must group by

- risk/severity
- requested action
- requester/actor
- organization/project
- age/deadline
- authority requirement

### Approval Detail must show before human action

- exact command/action requested
- why approval is required
- requester
- target resource
- affected tasks/artifacts
- evidence
- risk analysis
- estimated cost/impact
- policy rule that required approval
- Approve / Reject / Request Changes

### Decision UX-010-03

Approval Center is promoted to a P0 top-level control surface and participates in the global Human Attention count.

---

## Discussion 4 — Schedule & Cron

Schedule is not just a calendar. It combines recurring agent work, automation, reviews, maintenance windows, deployments, milestones, and reminders.

### Schedule list/calendar must show

- human-readable schedule
- cron expression
- timezone
- owner
- linked task/automation
- next run
- status/health
- recent success/failure rate

### Schedule Detail

- human-readable rule + raw cron
- timezone
- owner
- next/previous run
- run history
- linked resources
- execution policy
- missed/failed runs
- Run Now / Pause / Edit controls

### Decision UX-010-04

Never display a cron expression without a human-readable interpretation and timezone.

---

## Discussion 5 — Event Explorer

Activity, Event, and Trace remain separate levels:

- Activity: human-readable organizational summary
- Event: immutable authoritative/audit record
- Trace: low-level model/tool/sandbox execution diagnostics

### Event Explorer requires

- ordered organization sequence
- time
- type
- actor
- aggregate/resource
- project/task/run
- severity
- correlation ID
- causation ID
- source subsystem

### Event Detail

- normalized event fields
- related actor/task/artifact/decision/run
- correlation/causation chain
- acknowledgements when relevant
- raw payload
- deep links

### Decision UX-010-05

Event Explorer is the audit surface, not a replacement for agent/provider traces.

---

## Discussion 6 — Cross-module navigation

All major objects must deep-link to each other.

Examples:

```text
Approval -> Command -> Task -> Agent -> Artifact
Artifact -> Version -> Producing Task -> Decision -> Consumers
Event -> Actor -> Task -> Artifact -> Decision
Schedule -> Run -> Task -> Agent -> Events
Decision -> Impacted Artifacts/Tasks -> Events
```

### Decision UX-010-06

No dead-end detail pages. Every authoritative object exposes Relations and Events.

---

## Discussion 7 — Shared detail shell

The approved shell from Meeting #008 is retained:

```text
Identity / Status / Primary actions
Lifecycle / important metadata
Main content                 Context rail
Overview                     Owner / authority
Evidence / relations         Risks / blockers
Discussion                   Approvals
Activity / events            Related objects
Metrics                      Secondary actions
```

The exact panels differ by entity, but navigation and interaction language stay consistent.

---

## Prototype implementation scope

Meeting #010 authorizes extending `prototype/ui-v0.1` with:

1. Artifact Registry + Artifact Detail
2. Decision Registry + Decision Detail
3. Approval Center + Approval Detail
4. Schedule/Cron + Schedule Detail
5. Event Explorer + Event Detail
6. Cross-links among these views and existing Project/Task/Agent views

Mock data is acceptable because the prototype is for interaction validation. Mock values must represent legitimate AOP domain concepts rather than frontend-only semantics.

## Final decisions

- UX-010-01 Artifact lineage/versioning is first-class.
- UX-010-02 Decisions are authoritative objects, never implicit chat conclusions.
- UX-010-03 Approval Center is P0 and part of Human Attention.
- UX-010-04 Schedule always presents human-readable rule + timezone + raw cron.
- UX-010-05 Events and traces remain separate observability layers.
- UX-010-06 Major objects must be cross-linked; no dead-end detail pages.
- UX-010-07 Shared detail shell/status vocabulary remains mandatory.

## Next review gate

After the prototype extension, review the complete operational loop:

```text
Attention
 -> Approval
 -> Decision
 -> Artifact
 -> Task/Run
 -> Schedule
 -> Event/Audit
 -> back to Attention
```

The next meeting should focus on navigation usability, information density, and whether a founder can identify/resolve a real exception without reading agent conversations.
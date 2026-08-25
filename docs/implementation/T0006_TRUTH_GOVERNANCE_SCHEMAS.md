# T0006 — Artifact / Decision / Review / Permission / Approval Schemas

Date: 2026-08-25
Status: IMPLEMENTED — package install/test gate pending registry access

## Added

### Artifact

- logical Artifact identity
- immutable ArtifactVersion payload metadata
- content URI / MIME / SHA-256 / size
- provenance and lineage references
- explicit approval metadata

### Decision

- structured question/options
- selected option and rationale
- authority capability
- active/superseded/rejected lifecycle
- affected resource references

### Review

- structured criteria
- evidence references
- pass/rework/fail result
- completion timestamp invariant

### Permission

- principal + capability + effect
- `allow | require_approval | deny`
- optional resource scope
- structured conditions
- explicit grantor

### Approval

- durable approval request linked to Command ID
- risk / policy rule / evidence / impact
- explicit required authority
- decision metadata
- schema-level guarantee that a `human` approval cannot be decided by an Agent Principal

## Boundary rule

Schema validation establishes payload shape and local invariants only. The Policy Engine remains responsible for whether a grantor/approver actually has authority in the current organization state.

## Shared-truth principle represented

```text
conversation
   -> proposal
   -> Decision / Artifact / Review / Approval object
   -> deterministic authorization / lifecycle
   -> authoritative state
```

## Next ticket

T0007 — Command / Event / ContextManifest envelopes and structured errors.

# T0007 — Command / Event / ContextManifest Envelopes

Date: 2026-08-25
Status: IMPLEMENTED — package install/test gate pending registry access

## Added

### Command Envelope

Every mutation intent carries:

- schema/protocol version
- command ID
- command type
- organization scope
- actor Principal
- optional target ResourceRef
- optional expected revision
- idempotency key
- structured payload
- issue timestamp

### Event Envelope

Every committed fact carries:

- event ID
- ordered organization sequence
- aggregate ResourceRef + revision
- actor
- causation Command ID when applicable
- correlation ID
- structured payload
- committed timestamp

### Structured errors

Initial error codes:

- validation_error
- scope_mismatch
- revision_conflict
- forbidden
- approval_required
- invariant_violation
- not_found
- idempotency_conflict
- internal_error

`approval_required` must link to a durable ApprovalRequest.

### Context Manifest

A Context Manifest records the exact context classes supplied to an Agent Run, including trust classification, source, revision, mandatory flag, ranking weights, token estimate and optional content digest.

Mandatory baseline classes:

- policy
- identity
- role
- goal
- task
- output_contract

The manifest validates that its total token estimate equals the sum of fragment estimates.

## Core transaction model now represented

```text
Command
  -> validate / authorize / mutate
  -> Event

TaskRun
  -> ContextManifest
  -> Agent Runtime
```

## Next ticket

T0008 — Database bootstrap and migration 0001.

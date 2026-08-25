# T0001 — Repository Foundation

Date: 2026-08-25
Status: IMPLEMENTED — dependency gate pending external registry validation

## Scope

- pnpm workspace
- four application workspaces
- fifteen package workspaces
- shared strict TypeScript configuration
- project references
- Vitest baseline
- Biome lint/format baseline
- root build/typecheck/test/lint/check scripts
- repository ignore/editor/package-manager policy

## Toolchain baseline

- Node >= 22.16
- pnpm 11.21
- TypeScript 6.x
- Vitest 4.1.x
- Biome 2.5.x

## Workspace map

```text
apps/
  api
  worker
  web
  sandbox-runner

packages/
  protocol
  domain
  database
  command-bus
  event-bus
  policy-engine
  scheduler
  artifact-store
  context-engine
  runtime
  runtime-openai
  runtime-a2a
  tools-mcp
  observability
  testing
```

## Acceptance commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

The implementation environment used to prepare this ticket does not have outbound package-registry access, so install/Vitest/Biome execution must be confirmed by CI or a developer machine with registry access. The TypeScript project-reference structure was validated separately with the available local compiler.

## Next ticket

T0002 — Docker local dependencies.

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@aop/command-bus": source("./packages/command-bus/src/index.ts"),
      "@aop/context-engine": source("./packages/context-engine/src/index.ts"),
      "@aop/database": source("./packages/database/src/index.ts"),
      "@aop/domain": source("./packages/domain/src/index.ts"),
      "@aop/event-bus": source("./packages/event-bus/src/index.ts"),
      "@aop/policy-engine": source("./packages/policy-engine/src/index.ts"),
      "@aop/protocol": source("./packages/protocol/src/index.ts"),
      "@aop/runtime": source("./packages/runtime/src/index.ts"),
      "@aop/scheduler": source("./packages/scheduler/src/index.ts"),
    },
  },
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    passWithNoTests: true,
  },
});

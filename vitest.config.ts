import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@aop/database": source("./packages/database/src/index.ts"),
      "@aop/domain": source("./packages/domain/src/index.ts"),
      "@aop/policy-engine": source("./packages/policy-engine/src/index.ts"),
      "@aop/protocol": source("./packages/protocol/src/index.ts"),
    },
  },
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    passWithNoTests: true,
  },
});

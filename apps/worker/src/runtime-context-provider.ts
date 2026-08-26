import type { PostgresContextManifestStore } from "@aop/database";
import type { ContextManifestProvider } from "@aop/runtime";

export class PostgresRuntimeContextProvider implements ContextManifestProvider {
  readonly #store: PostgresContextManifestStore;

  constructor(store: PostgresContextManifestStore) {
    this.#store = store;
  }

  getOrCompile(input: Parameters<ContextManifestProvider["getOrCompile"]>[0]) {
    return this.#store.compileInitialManifest(input);
  }
}

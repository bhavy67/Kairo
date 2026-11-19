import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test boots an in-process Postgres (PGlite). The first boot compiles its
    // WASM and can exceed Vitest's 5 s default on a loaded CI runner; warm tests take
    // well under a second, so this only absorbs cold start, not slow code.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

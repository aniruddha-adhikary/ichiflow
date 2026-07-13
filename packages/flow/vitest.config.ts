import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Temporal test env + workflow bundling is heavy and stateful; run the file serially with a
    // generous timeout rather than under the parallel worker pool.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});

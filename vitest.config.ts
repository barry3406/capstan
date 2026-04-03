import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": fileURLToPath(new URL("./tests/helpers/bun-test.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    pool: "forks",
    fileParallelism: false,
    maxConcurrency: 1
  }
});

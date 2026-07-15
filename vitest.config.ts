import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // In CI, a stray `.only` must fail the run instead of silently shrinking
    // the suite. Left permissive locally so `.only` is still usable while
    // iterating on a single test.
    forbidOnly: Boolean(process.env.CI),
  },
});

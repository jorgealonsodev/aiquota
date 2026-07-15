// Proves the Vitest runner works end-to-end (packaging spec: Test Tooling
// Bootstrap). Not part of the product domain — safe to remove once a real
// core module exercises the same runner in Phase 2.
export function add(a: number, b: number): number {
  return a + b;
}

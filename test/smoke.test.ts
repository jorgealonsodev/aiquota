import { describe, expect, it } from "vitest";
import { add } from "../src/shared/smoke";

describe("test tooling bootstrap (packaging spec: Test Tooling Bootstrap)", () => {
  it("runs a real assertion against production code", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("handles a different pair of inputs correctly", () => {
    expect(add(-4, 10)).toBe(6);
  });
});

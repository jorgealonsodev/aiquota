import { describe, expect, it } from "vitest";
import { nextFetchMode } from "../../src/core/cf";

describe("nextFetchMode() Cloudflare escalation table (design D4/S2)", () => {
  it("escalates from hidden to visible when a challenge is detected", () => {
    expect(nextFetchMode(true, "hidden")).toBe("visible");
  });

  it("stays hidden when no challenge is detected while already hidden", () => {
    expect(nextFetchMode(false, "hidden")).toBe("hidden");
  });

  it("stays visible while the challenge persists", () => {
    expect(nextFetchMode(true, "visible")).toBe("visible");
  });

  it("de-escalates back to hidden once the challenge clears (schedules a hidden retry)", () => {
    expect(nextFetchMode(false, "visible")).toBe("hidden");
  });
});

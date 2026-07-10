import { describe, expect, it } from "vitest";
import { aggregate } from "../../src/core/aggregate";
import type { InstanceSnapshot } from "../../src/core/aggregate";
import { WINDOW_KIND } from "../../src/shared/domain";

function snapshot(overrides: Partial<InstanceSnapshot> = {}): InstanceSnapshot {
  return {
    instanceId: "codex-1",
    label: "Codex",
    enabled: true,
    status: "healthy",
    windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 10, resetsAt: null }],
    ...overrides,
  };
}

describe("aggregate() tray contract (tray-status spec)", () => {
  it("is green when every enabled/configured instance is below 70%", () => {
    const result = aggregate([
      snapshot({ instanceId: "codex-1", windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 42, resetsAt: null }] }),
      snapshot({ instanceId: "claude-1", label: "Claude", windows: [{ kind: WINDOW_KIND.SevenDay, label: "Last 7 days", utilization: 61, resetsAt: null }] }),
    ]);

    expect(result.color).toBe("green");
  });

  it("is amber when the highest utilization is between 70 and 90 inclusive", () => {
    const resultAtLowerBound = aggregate([
      snapshot({ windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 70, resetsAt: null }] }),
    ]);
    const resultAtUpperBound = aggregate([
      snapshot({ windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 90, resetsAt: null }] }),
    ]);

    expect(resultAtLowerBound.color).toBe("amber");
    expect(resultAtUpperBound.color).toBe("amber");
  });

  it("is red when any instance exceeds 90%, regardless of other instances' state", () => {
    const result = aggregate([
      snapshot({ instanceId: "codex-1", windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 95, resetsAt: null }] }),
      snapshot({ instanceId: "claude-1", label: "Claude", windows: [{ kind: WINDOW_KIND.SevenDay, label: "Last 7 days", utilization: 5, resetsAt: null }] }),
    ]);

    expect(result.color).toBe("red");
  });

  it("is gray when every instance is disabled, unconfigured, or in an error state", () => {
    const result = aggregate([
      snapshot({ instanceId: "codex-1", enabled: false }),
      snapshot({ instanceId: "claude-1", label: "Claude", status: "unconfigured", windows: [] }),
      snapshot({ instanceId: "codex-2", status: "provider-broken", windows: [] }),
    ]);

    expect(result.color).toBe("gray");
  });

  it("excludes disabled instances from the tooltip and from tray color", () => {
    const result = aggregate([
      snapshot({
        instanceId: "codex-1",
        windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 34, resetsAt: null }],
      }),
      snapshot({
        instanceId: "claude-1",
        label: "Claude",
        enabled: false,
        windows: [{ kind: WINDOW_KIND.SevenDay, label: "Last 7 days", utilization: 99, resetsAt: null }],
      }),
    ]);

    expect(result.tooltip).toBe("Codex 34%");
    expect(result.color).toBe("green");
  });

  it("shows an error indicator instead of a stale/fabricated percentage for a failing instance", () => {
    const result = aggregate([
      snapshot({ instanceId: "codex-1", status: "auth-expired", windows: [] }),
      snapshot({
        instanceId: "claude-1",
        label: "Claude",
        windows: [{ kind: WINDOW_KIND.SevenDay, label: "Last 7 days", utilization: 62, resetsAt: null }],
      }),
    ]);

    expect(result.tooltip).toBe("Codex error · Claude 62%");
  });

  it("is red exactly at the 91% boundary (just above the 90% amber ceiling)", () => {
    const result = aggregate([
      snapshot({ windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 91, resetsAt: null }] }),
    ]);

    expect(result.color).toBe("red");
  });

  it("is gray for an empty snapshot list", () => {
    const result = aggregate([]);

    expect(result.color).toBe("gray");
    expect(result.tooltip).toBe("");
  });

  it("is red when a red instance sits alongside a separate erroring instance (red wins, literal spec scenario)", () => {
    const result = aggregate([
      snapshot({
        instanceId: "codex-1",
        windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 95, resetsAt: null }],
      }),
      snapshot({ instanceId: "claude-1", label: "Claude", status: "provider-broken", windows: [] }),
    ]);

    expect(result.color).toBe("red");
  });
});

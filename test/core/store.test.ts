import { describe, expect, it } from "vitest";
import { StateStore } from "../../src/core/store";
import { WINDOW_KIND } from "../../src/shared/domain";

describe("StateStore (design.md Data Flow: StateStore -> aggregate())", () => {
  it("creates a new snapshot with sensible defaults for fields not provided", () => {
    const store = new StateStore();

    const snapshot = store.update("codex-1", { label: "Personal Codex", enabled: true });

    expect(snapshot).toEqual({
      instanceId: "codex-1",
      label: "Personal Codex",
      enabled: true,
      status: "unconfigured",
      windows: [],
    });
  });

  it("merges a partial patch into an existing snapshot, preserving untouched fields", () => {
    const store = new StateStore();
    store.update("codex-1", {
      label: "Personal Codex",
      enabled: true,
      status: "healthy",
      windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 40, resetsAt: null }],
    });

    const updated = store.update("codex-1", {
      windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 55, resetsAt: null }],
    });

    expect(updated.label).toBe("Personal Codex");
    expect(updated.enabled).toBe(true);
    expect(updated.status).toBe("healthy");
    expect(updated.windows[0].utilization).toBe(55);
  });

  it("isolates instances: updating one instanceId does not affect another", () => {
    const store = new StateStore();
    store.update("codex-1", { label: "Codex", enabled: true, status: "healthy" });
    store.update("claude-1", { label: "Claude", enabled: true, status: "auth-expired" });

    store.update("codex-1", { status: "network" });

    expect(store.get("codex-1")?.status).toBe("network");
    expect(store.get("claude-1")?.status).toBe("auth-expired");
  });

  it("removes a snapshot so it no longer appears in getAll()", () => {
    const store = new StateStore();
    store.update("codex-1", { label: "Codex" });
    store.update("claude-1", { label: "Claude" });

    store.remove("codex-1");

    expect(store.get("codex-1")).toBeUndefined();
    expect(store.getAll().map((s) => s.instanceId)).toEqual(["claude-1"]);
  });

  it("returns all current snapshots via getAll()", () => {
    const store = new StateStore();
    store.update("codex-1", { label: "Codex" });
    store.update("claude-1", { label: "Claude" });

    expect(store.getAll().map((s) => s.instanceId).sort()).toEqual(["claude-1", "codex-1"]);
  });
});

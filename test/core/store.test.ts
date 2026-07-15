import { describe, expect, it } from "vitest";
import { StateStore } from "../../src/core/store";
import { WINDOW_KIND } from "../../src/shared/domain";

describe("StateStore (design.md Data Flow: StateStore -> aggregate())", () => {
  it("register() creates a snapshot with sensible defaults for fields not provided", () => {
    const store = new StateStore();

    const snapshot = store.register("codex-1", { label: "Personal Codex", enabled: true });

    expect(snapshot).toEqual({
      instanceId: "codex-1",
      label: "Personal Codex",
      enabled: true,
      status: "unconfigured",
      windows: [],
    });
  });

  it("update() merges a partial patch into an existing (registered) snapshot, preserving untouched fields", () => {
    const store = new StateStore();
    store.register("codex-1", {
      label: "Personal Codex",
      enabled: true,
      status: "healthy",
      windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 40, resetsAt: null }],
    });

    store.update("codex-1", {
      windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 55, resetsAt: null }],
      fetchedAt: 100,
    });

    const updated = store.get("codex-1");
    expect(updated?.label).toBe("Personal Codex");
    expect(updated?.enabled).toBe(true);
    expect(updated?.status).toBe("healthy");
    expect(updated?.windows[0].utilization).toBe(55);
  });

  it("isolates instances: updating one instanceId does not affect another", () => {
    const store = new StateStore();
    store.register("codex-1", { label: "Codex", enabled: true, status: "healthy" });
    store.register("claude-1", { label: "Claude", enabled: true, status: "auth-expired" });

    store.update("codex-1", { status: "network" });

    expect(store.get("codex-1")?.status).toBe("network");
    expect(store.get("claude-1")?.status).toBe("auth-expired");
  });

  it("removes a snapshot so it no longer appears in getAll()", () => {
    const store = new StateStore();
    store.register("codex-1", { label: "Codex" });
    store.register("claude-1", { label: "Claude" });

    store.remove("codex-1");

    expect(store.get("codex-1")).toBeUndefined();
    expect(store.getAll().map((s) => s.instanceId)).toEqual(["claude-1"]);
  });

  it("returns all current snapshots via getAll()", () => {
    const store = new StateStore();
    store.register("codex-1", { label: "Codex" });
    store.register("claude-1", { label: "Claude" });

    expect(store.getAll().map((s) => s.instanceId).sort()).toEqual(["claude-1", "codex-1"]);
  });

  it("ignores update() for an instanceId that was never registered (no zombie resurrection)", () => {
    const store = new StateStore();

    const result = store.update("ghost-1", { label: "Ghost" });

    expect(result).toBeUndefined();
    expect(store.getAll()).toEqual([]);
  });

  it("ignores update() for an instanceId after it has been removed", () => {
    const store = new StateStore();
    store.register("codex-1", { label: "Codex" });
    store.remove("codex-1");

    const result = store.update("codex-1", { label: "Codex again" });

    expect(result).toBeUndefined();
    expect(store.getAll()).toEqual([]);
  });

  it("rejects a stale update whose fetchedAt is older than the current snapshot's, keeping the newest data", () => {
    const store = new StateStore();
    store.register("codex-1", { status: "healthy" });

    store.update("codex-1", {
      fetchedAt: 200,
      windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 90, resetsAt: null }],
    });
    // Out-of-order arrival: an older fetch result completes after the newer one.
    store.update("codex-1", {
      fetchedAt: 100,
      windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 10, resetsAt: null }],
    });

    const snapshot = store.get("codex-1");
    expect(snapshot?.windows[0].utilization).toBe(90);
  });

  it("accepts an update whose fetchedAt is newer than the current snapshot's", () => {
    const store = new StateStore();
    store.register("codex-1", { status: "healthy" });

    store.update("codex-1", {
      fetchedAt: 100,
      windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 10, resetsAt: null }],
    });
    store.update("codex-1", {
      fetchedAt: 200,
      windows: [{ kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 90, resetsAt: null }],
    });

    expect(store.get("codex-1")?.windows[0].utilization).toBe(90);
  });

  it("exposes fetchedAt on the snapshot after an update carries one (quota-popup spec: Last Update Timestamp)", () => {
    const store = new StateStore();
    store.register("codex-1", { status: "healthy" });

    store.update("codex-1", { fetchedAt: 12345, windows: [] });

    expect(store.get("codex-1")?.fetchedAt).toBe(12345);
  });

  it("defaults fetchedAt to undefined for a freshly registered instance that has never been fetched", () => {
    const store = new StateStore();

    const snapshot = store.register("codex-1", { label: "Codex" });

    expect(snapshot.fetchedAt).toBeUndefined();
  });
});

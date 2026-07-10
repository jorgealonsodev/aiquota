// Pure per-instance state store (design.md Data Flow:
// "StateStore --> aggregate() --> TrayState"). Holds the latest
// InstanceSnapshot for each ProviderInstance; the shell (Phase 4) feeds it
// poll results and reads getAll() to build both the tray aggregate() input
// and the IPC state:update push payload.
import type { InstanceSnapshot } from "./aggregate";

const DEFAULT_SNAPSHOT_DEFAULTS: Pick<InstanceSnapshot, "label" | "enabled" | "status" | "windows"> = {
  label: "",
  enabled: false,
  status: "unconfigured",
  windows: [],
};

export class StateStore {
  private readonly snapshots = new Map<string, InstanceSnapshot>();

  /**
   * Merges `patch` into the existing snapshot for `instanceId` (or creates
   * one with sensible defaults if none exists yet), and returns the
   * resulting snapshot.
   */
  update(instanceId: string, patch: Partial<Omit<InstanceSnapshot, "instanceId">>): InstanceSnapshot {
    const existing = this.snapshots.get(instanceId);
    const merged: InstanceSnapshot = {
      instanceId,
      label: patch.label ?? existing?.label ?? DEFAULT_SNAPSHOT_DEFAULTS.label,
      enabled: patch.enabled ?? existing?.enabled ?? DEFAULT_SNAPSHOT_DEFAULTS.enabled,
      status: patch.status ?? existing?.status ?? DEFAULT_SNAPSHOT_DEFAULTS.status,
      windows: patch.windows ?? existing?.windows ?? DEFAULT_SNAPSHOT_DEFAULTS.windows,
    };
    this.snapshots.set(instanceId, merged);
    return merged;
  }

  /** Removes an instance's snapshot (e.g. the user deleted the account). */
  remove(instanceId: string): void {
    this.snapshots.delete(instanceId);
  }

  get(instanceId: string): InstanceSnapshot | undefined {
    return this.snapshots.get(instanceId);
  }

  getAll(): InstanceSnapshot[] {
    return [...this.snapshots.values()];
  }
}

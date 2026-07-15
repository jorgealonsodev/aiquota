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

/**
 * A partial update to an existing snapshot. `fetchedAt`, when provided, is
 * both stored on the resulting snapshot (so the popup can render a
 * "last updated" indicator — quota-popup spec) and used to reject
 * out-of-order writes: a patch whose fetchedAt is older than the
 * snapshot's current fetchedAt is ignored entirely (a slow retry
 * completing after a newer result must not overwrite it).
 */
export type UpdatePatch = Partial<Omit<InstanceSnapshot, "instanceId">>;

export class StateStore {
  private readonly snapshots = new Map<string, InstanceSnapshot>();

  /**
   * Explicitly adds `instanceId` to the store with an initial snapshot.
   * This is the ONLY way a snapshot is created — update() is a no-op for
   * any instanceId that hasn't been register()ed (or that was remove()d),
   * so a late-arriving poll result can never resurrect a deleted account
   * as a "zombie" snapshot.
   */
  register(instanceId: string, initial: Partial<Omit<InstanceSnapshot, "instanceId">> = {}): InstanceSnapshot {
    const snapshot: InstanceSnapshot = {
      instanceId,
      label: initial.label ?? DEFAULT_SNAPSHOT_DEFAULTS.label,
      enabled: initial.enabled ?? DEFAULT_SNAPSHOT_DEFAULTS.enabled,
      status: initial.status ?? DEFAULT_SNAPSHOT_DEFAULTS.status,
      windows: initial.windows ?? DEFAULT_SNAPSHOT_DEFAULTS.windows,
      fetchedAt: initial.fetchedAt,
    };
    this.snapshots.set(instanceId, snapshot);
    return snapshot;
  }

  /**
   * Merges `patch` into the existing snapshot for `instanceId`. Returns
   * `undefined` (a no-op) if the instance was never register()ed or has
   * since been remove()d. If `patch.fetchedAt` is provided and is older
   * than the snapshot's current fetchedAt, the entire patch is ignored and
   * the current snapshot is returned unchanged.
   */
  update(instanceId: string, patch: UpdatePatch): InstanceSnapshot | undefined {
    const existing = this.snapshots.get(instanceId);
    if (!existing) return undefined;

    if (patch.fetchedAt !== undefined && existing.fetchedAt !== undefined && patch.fetchedAt < existing.fetchedAt) {
      return existing;
    }

    const merged: InstanceSnapshot = {
      instanceId,
      label: patch.label ?? existing.label,
      enabled: patch.enabled ?? existing.enabled,
      status: patch.status ?? existing.status,
      windows: patch.windows ?? existing.windows,
      fetchedAt: patch.fetchedAt ?? existing.fetchedAt,
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

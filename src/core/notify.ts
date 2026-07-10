// Pure notify-once engine (design.md "Scheduler & Notifications";
// notifications spec). Holds no Electron Notification API knowledge — the
// shell (Phase 4) turns these events into native OS notifications.
import type { AuthStatus } from "../shared/domain";

/**
 * A single quota-window reading for one instance, as produced by a
 * provider adapter after normalization. `kind` is QuotaWindow.kind — the
 * notify-once key's "windowType" IS this same field (design.md clarifies
 * there is no separate windowType property).
 */
export interface WindowReading {
  instanceId: string;
  kind: string;
  utilization: number;
  resetsAt: string | null;
}

export interface ThresholdCrossedEvent {
  type: "threshold-crossed";
  instanceId: string;
  windowKind: string;
  threshold: number;
  resetsAt: string | null;
}

export interface ReconnectNeededEvent {
  type: "reconnect-needed";
  instanceId: string;
}

/** Minimal clock port so NotifyEngine can prune expired entries by real time. */
export interface NotifyClock {
  now(): number;
}

const REAL_CLOCK: NotifyClock = { now: () => Date.now() };

function notifyOnceKey(instanceId: string, kind: string, resetsAt: string | null, threshold: number): string {
  return `${instanceId}|${kind}|${resetsAt ?? "null"}|${threshold}`;
}

export class NotifyEngine {
  /** Notify-once key -> the resetsAt it was recorded for (for pruning). */
  private readonly notifiedKeys = new Map<string, string | null>();
  private readonly lastAuthStatus = new Map<string, AuthStatus>();

  constructor(private readonly clock: NotifyClock = REAL_CLOCK) {}

  /**
   * Evaluates a window reading against configured thresholds. Each
   * threshold fires at most once per (instanceId, kind, resetsAt, threshold)
   * key — the key naturally re-arms itself once resetsAt changes (new
   * window generation), so no separate reset step is needed. Also prunes
   * any notify-once entries whose resetsAt has already elapsed, bounding
   * memory growth for a long-running multi-day process.
   */
  processWindow(reading: WindowReading, thresholds: number[]): ThresholdCrossedEvent[] {
    this.pruneExpired();

    const events: ThresholdCrossedEvent[] = [];

    for (const threshold of thresholds) {
      if (reading.utilization < threshold) continue;

      const key = notifyOnceKey(reading.instanceId, reading.kind, reading.resetsAt, threshold);
      if (this.notifiedKeys.has(key)) continue;

      this.notifiedKeys.set(key, reading.resetsAt);
      events.push({
        type: "threshold-crossed",
        instanceId: reading.instanceId,
        windowKind: reading.kind,
        threshold,
        resetsAt: reading.resetsAt,
      });
    }

    return events;
  }

  /**
   * Emits a one-shot reconnect-needed event on each transition INTO
   * auth-expired. Recovering to any other status clears the transition
   * marker, so a later auth-expired failure fires again.
   */
  processAuthStatus(instanceId: string, status: AuthStatus): ReconnectNeededEvent[] {
    const previous = this.lastAuthStatus.get(instanceId);
    this.lastAuthStatus.set(instanceId, status);

    if (status === "auth-expired" && previous !== "auth-expired") {
      return [{ type: "reconnect-needed", instanceId }];
    }
    return [];
  }

  /**
   * Evicts all notify-once and auth-status state for a removed instance,
   * so a later re-added instance with the same instanceId starts fresh
   * (first-time threshold and reconnect notifications fire again).
   */
  remove(instanceId: string): void {
    const prefix = `${instanceId}|`;
    for (const key of this.notifiedKeys.keys()) {
      if (key.startsWith(prefix)) this.notifiedKeys.delete(key);
    }
    this.lastAuthStatus.delete(instanceId);
  }

  private pruneExpired(): void {
    const now = this.clock.now();
    for (const [key, resetsAt] of this.notifiedKeys) {
      if (resetsAt !== null && new Date(resetsAt).getTime() < now) {
        this.notifiedKeys.delete(key);
      }
    }
  }
}

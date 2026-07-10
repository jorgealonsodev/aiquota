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

function notifyOnceKey(instanceId: string, kind: string, resetsAt: string | null, threshold: number): string {
  return `${instanceId}|${kind}|${resetsAt ?? "null"}|${threshold}`;
}

export class NotifyEngine {
  private readonly notifiedKeys = new Set<string>();
  private readonly lastAuthStatus = new Map<string, AuthStatus>();

  /**
   * Evaluates a window reading against configured thresholds. Each
   * threshold fires at most once per (instanceId, kind, resetsAt, threshold)
   * key — the key naturally re-arms itself once resetsAt changes (new
   * window generation), so no separate reset step is needed.
   */
  processWindow(reading: WindowReading, thresholds: number[]): ThresholdCrossedEvent[] {
    const events: ThresholdCrossedEvent[] = [];

    for (const threshold of thresholds) {
      if (reading.utilization < threshold) continue;

      const key = notifyOnceKey(reading.instanceId, reading.kind, reading.resetsAt, threshold);
      if (this.notifiedKeys.has(key)) continue;

      this.notifiedKeys.add(key);
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
}

// Native notification bridge (notifications spec). The main process calls
// these helpers when the NotifyEngine emits threshold-crossed or
// reconnect-needed events. This file is shell code and is covered by manual
// QA, not unit tests.
import { Notification } from "electron";
import type { ThresholdCrossedEvent, ReconnectNeededEvent } from "../core/notify";

/**
 * Shows a one-shot OS notification when a configured threshold is crossed.
 */
export function showThresholdNotification(event: ThresholdCrossedEvent): void {
  new Notification({
    title: "AIQuota",
    body: `${event.instanceId} ${event.windowKind} crossed ${event.threshold}%`,
  }).show();
}

/**
 * Shows a one-shot OS notification when an instance transitions into
 * auth-expired and needs a reconnect.
 */
export function showReconnectNotification(event: ReconnectNeededEvent): void {
  new Notification({
    title: "AIQuota",
    body: `${event.instanceId} session expired. Reconnect to resume polling.`,
  }).show();
}

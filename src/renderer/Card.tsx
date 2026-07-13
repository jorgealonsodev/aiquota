// Per-account card for the popup (quota-popup spec). Displays per-window
// progress, a live reset countdown, a last-updated indicator, a refresh
// button, and error/reconnect states. Receives the IPC API via props so
// tests can render it without a real `window.electronAPI`.
//
// `formatCountdown()`/`formatLastUpdated()` are pure functions extracted so
// they are unit-testable (test/renderer/cardFormatting.test.ts), per this
// project's convention of splitting pure logic out of otherwise-untested
// shell/UI components (design.md Testing Strategy). The component ticks its
// own clock every 60s via setInterval so the countdown/last-updated text
// visibly updates as time passes; that re-render wiring itself is untested
// shell code (renderToStaticMarkup has no jsdom and cannot observe
// re-renders) — `now` is injectable via props for deterministic rendering
// tests instead.
import { useCallback, useEffect, useState } from "react";
import type { InstanceViewModel } from "../shared/ipc";
import type { ElectronAPI } from "../preload/index";

export interface CardProps {
  instance: InstanceViewModel;
  api?: ElectronAPI;
  /** Injectable "current time" for deterministic tests; defaults to a self-ticking clock (60s interval). */
  now?: Date;
}

const TICK_INTERVAL_MS = 60_000;

/**
 * Pure formatting for a window's reset countdown (quota-popup spec,
 * "Per-Window Progress and Reset Countdown": "the countdown displays
 * approximately 1h 30m remaining, updating as time passes").
 */
export function formatCountdown(resetsAt: string | null, now: Date): string {
  if (!resetsAt) return "resets unknown";
  const resetDate = new Date(resetsAt);
  if (Number.isNaN(resetDate.getTime())) return "resets unknown";

  const diffMs = resetDate.getTime() - now.getTime();
  if (diffMs <= 0) return "resets now";

  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  if (minutes > 0) return `${minutes}m remaining`;
  return "<1m remaining";
}

/**
 * Pure formatting for the "last updated" indicator (quota-popup spec,
 * "Last Update Timestamp and Manual Refresh": 'it displays a "last updated
 * 3 minutes ago" indicator').
 */
export function formatLastUpdated(fetchedAt: number | undefined, now: Date): string {
  if (fetchedAt === undefined) return "last updated: unknown";

  const diffMs = now.getTime() - fetchedAt;
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "last updated just now";
  if (minutes === 1) return "last updated 1 minute ago";
  if (minutes < 60) return `last updated ${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "last updated 1 hour ago";
  if (hours < 24) return `last updated ${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "last updated 1 day ago" : `last updated ${days} days ago`;
}

function ErrorState({
  status,
  label,
  onReconnect,
}: {
  status: InstanceViewModel["status"];
  label: string;
  onReconnect: () => void;
}): JSX.Element {
  if (status === "auth-expired") {
    return (
      <div className="card-error">
        Session expired.{" "}
        <button type="button" onClick={onReconnect} aria-label={`Reconnect ${label}`}>
          Reconnect
        </button>
      </div>
    );
  }
  if (status === "network") {
    return <div className="card-error">Offline. Retry shortly.</div>;
  }
  if (status === "provider-broken") {
    return <div className="card-error">Provider error. Check status.</div>;
  }
  return <div className="card-unconfigured">Not configured</div>;
}

export function Card({ instance, api, now }: CardProps): JSX.Element {
  const [tick, setTick] = useState<Date>(() => now ?? new Date());

  useEffect(() => {
    if (now) return;
    const id = setInterval(() => setTick(new Date()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [now]);

  const effectiveNow = now ?? tick;

  // Also used as the auth-expired "Reconnect" action below: a successful
  // scheduler.refresh() un-suspends polling for this instance (see
  // src/core/scheduler.ts's executePoll) and clears the notify-once
  // auth-expired marker (src/main/index.ts's scheduleInstance success path,
  // per src/core/notify.ts's processAuthStatus contract) — the same
  // underlying recovery action as a normal refresh.
  const handleRefresh = useCallback(() => {
    api?.refresh(instance.instanceId);
  }, [api, instance.instanceId]);

  return (
    <article className="card" data-instance-id={instance.instanceId} data-status={instance.status}>
      <header className="card-header">
        <h3>{instance.label}</h3>
        {instance.status === "healthy" && (
          <button type="button" onClick={handleRefresh} aria-label={`Refresh ${instance.label}`}>
            Refresh
          </button>
        )}
      </header>

      {instance.status !== "healthy" ? (
        <ErrorState status={instance.status} label={instance.label} onReconnect={handleRefresh} />
      ) : (
        <>
          <div className="card-last-updated">{formatLastUpdated(instance.fetchedAt, effectiveNow)}</div>
          <ul className="card-windows">
            {instance.windows.map((window) => (
              <li key={window.kind} className="card-window">
                <div className="card-window-header">
                  <span>{window.label}</span>
                  <span>{Math.round(window.utilization)}%</span>
                </div>
                <progress value={window.utilization} max={100} aria-label={`${window.label} utilization`}>
                  {Math.round(window.utilization)}%
                </progress>
                <div className="card-window-meta">{formatCountdown(window.resetsAt, effectiveNow)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

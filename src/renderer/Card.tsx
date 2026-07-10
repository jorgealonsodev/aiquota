// Per-account card for the popup (quota-popup spec). Displays per-window
// progress, reset countdown, last-update time, refresh button, and
// error/reconnect states. Receives the IPC API via props so tests can render
// it without a real `window.electronAPI`.
import { useCallback } from "react";
import type { InstanceViewModel } from "../shared/ipc";
import type { ElectronAPI } from "../preload/index";

export interface CardProps {
  instance: InstanceViewModel;
  api?: ElectronAPI;
}

function formatResetsAt(resetsAt: string | null): string {
  if (!resetsAt) return "resets unknown";
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return "resets unknown";
  return `resets ${date.toLocaleTimeString()}`;
}

function ErrorState({ status }: { status: InstanceViewModel["status"] }): JSX.Element {
  if (status === "auth-expired") {
    return (
      <div className="card-error">
        Session expired. <button>Reconnect</button>
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

export function Card({ instance, api }: CardProps): JSX.Element {
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
        <ErrorState status={instance.status} />
      ) : (
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
              <div className="card-window-meta">{formatResetsAt(window.resetsAt)}</div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// Root popup component (quota-popup spec). Subscribes to `state:update`,
// renders the aggregate status and a Card for each visible instance. The
// IPC API is injected via props so tests can render without a real
// `window.electronAPI`.
import { useEffect, useState } from "react";
import type { AppStateSnapshot } from "../shared/ipc";
import type { ElectronAPI } from "../preload/index";
import { isVisibleInstance } from "../shared/domain";
import { Card } from "./Card";

export interface AppProps {
  api?: ElectronAPI;
  initialState?: AppStateSnapshot;
}

function emptyState(): AppStateSnapshot {
  return { color: "gray", tooltip: "", instances: [] };
}

export function App({ api, initialState }: AppProps): JSX.Element {
  const [state, setState] = useState<AppStateSnapshot>(initialState ?? emptyState());

  useEffect(() => {
    if (initialState === undefined) {
      api?.getState().then(setState);
    }
    return api?.onStateUpdate(setState);
  }, [api, initialState]);

  // Mirrors src/core/aggregate.ts's tray visibility rule (app-settings
  // spec: "Provider Enable/Disable", "Unconfigured Provider Handling"; also
  // quota-popup spec: "Per-Account Card Rendering") so the popup and the
  // tray never disagree about which instances are shown. Disabled or
  // unconfigured instances render no card; instances in an error state
  // still render (with a reconnect/error card).
  const visibleInstances = state.instances.filter(isVisibleInstance);

  return (
    <main className="app" data-tray-color={state.color}>
      <header className="app-header">
        <h1>AIQuota</h1>
        <span className="app-status" aria-label="Tray status">
          {state.tooltip || "No accounts"}
        </span>
      </header>

      {visibleInstances.length === 0 ? (
        <p className="app-empty">
          {state.instances.length === 0
            ? "No accounts configured."
            : "All accounts are disabled or unconfigured. Open Settings to enable one."}
        </p>
      ) : (
        <section className="app-cards">
          {visibleInstances.map((instance) => (
            <Card key={instance.instanceId} instance={instance} api={api} />
          ))}
        </section>
      )}
    </main>
  );
}

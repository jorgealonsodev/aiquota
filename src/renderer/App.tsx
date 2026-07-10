// Root popup component (quota-popup spec). Subscribes to `state:update`,
// renders the aggregate status and a Card for each instance. The IPC API is
// injected via props so tests can render without a real `window.electronAPI`.
import { useEffect, useState } from "react";
import type { AppStateSnapshot } from "../shared/ipc";
import type { ElectronAPI } from "../preload/index";
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

  return (
    <main className="app" data-tray-color={state.color}>
      <header className="app-header">
        <h1>AIQuota</h1>
        <span className="app-status" aria-label="Tray status">
          {state.tooltip || "No accounts"}
        </span>
      </header>

      {state.instances.length === 0 ? (
        <p className="app-empty">No accounts configured.</p>
      ) : (
        <section className="app-cards">
          {state.instances.map((instance) => (
            <Card key={instance.instanceId} instance={instance} api={api} />
          ))}
        </section>
      )}
    </main>
  );
}

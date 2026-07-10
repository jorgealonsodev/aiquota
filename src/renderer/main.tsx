// Renderer entry point (Phase 4). Mounts either the popup (`App`) or the
// settings form (`Settings`) based on the window URL query string.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Settings } from "./Settings";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Renderer root element #root not found");
}

const isSettings = new URLSearchParams(window.location.search).has("settings");

const api = window.electronAPI;

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    {isSettings ? <Settings api={api} /> : <App api={api} />}
  </StrictMode>,
);

// Expose the API type for consumers that need to declare `window.electronAPI`.
export type { ElectronAPI } from "../preload/index";


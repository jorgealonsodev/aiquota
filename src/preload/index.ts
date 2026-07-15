// Typed preload bridge (design D2/D3). Renderer runs with
// `contextIsolation:true` + `nodeIntegration:false` + `sandbox:true`, so the
// ONLY way it can talk to main is through this explicitly exposed API.
// Import `electron` dynamically: this module is loaded by the preload script
// in Electron, but it is also imported by Vitest tests. A static top-level
// `import { ipcRenderer } from "electron"` would trigger Electron's binary
// download side effect at module load time in tests.
import type { IpcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipc";
import type { AppStateSnapshot } from "../shared/ipc";
import type { Settings } from "../shared/domain";

export interface ElectronAPI {
  refresh(instanceId?: string): Promise<void>;
  getState(): Promise<AppStateSnapshot>;
  openSettings(): Promise<void>;
  addAccount(providerId: "codex" | "claude"): Promise<void>;
  getSettings(): Promise<Settings>;
  updateSettings(settings: Settings): Promise<void>;
  onStateUpdate(callback: (state: AppStateSnapshot) => void): () => void;
}

/**
 * Builds the typed renderer API from an `IpcRenderer` instance. Exported so
 * Vitest can verify the bridge without loading the real `electron` module.
 */
export function createElectronAPI(ipcRenderer: IpcRenderer): ElectronAPI {
  return {
    refresh: (instanceId?: string) =>
      instanceId === undefined ? ipcRenderer.invoke(IPC_CHANNELS.refresh) : ipcRenderer.invoke(IPC_CHANNELS.refresh, instanceId),

    getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState),

    openSettings: () => ipcRenderer.invoke(IPC_CHANNELS.openSettings),

    addAccount: (providerId: "codex" | "claude") => ipcRenderer.invoke(IPC_CHANNELS.addAccount, providerId),

    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),

    updateSettings: (settings: Settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, settings),

    onStateUpdate: (callback: (state: AppStateSnapshot) => void) => {
      const handler = (_event: unknown, state: AppStateSnapshot) => callback(state);
      ipcRenderer.on(IPC_CHANNELS.stateUpdate, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.stateUpdate, handler);
      };
    },
  };
}

async function init(): Promise<void> {
  const { contextBridge, ipcRenderer } = await import("electron");
  contextBridge.exposeInMainWorld("electronAPI", createElectronAPI(ipcRenderer));
}

// Auto-initialize only inside an actual Electron renderer/preload process.
// Vitest loads this module to test `createElectronAPI`; `process.type` is not
// "renderer" there, so we skip the side-effecting `contextBridge` call.
if (typeof process !== "undefined" && (process as { type?: string }).type === "renderer") {
  void init();
}

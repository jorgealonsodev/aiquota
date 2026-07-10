// Typed IPC channel map (design D3). Renderer -> main uses `invoke`;
// main -> renderer uses a one-way push on `state:update`.
import type { ProviderInstance, Settings } from "./domain";

export const IPC_CHANNELS = {
  refresh: "refresh",
  getState: "getState",
  openSettings: "openSettings",
  addAccount: "addAccount",
  getSettings: "getSettings",
  updateSettings: "updateSettings",
  stateUpdate: "state:update",
} as const;

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/**
 * Provisional shape of the state pushed to the renderer on `state:update`.
 * Phase 2's `src/core/aggregate.ts` defines the authoritative TrayState;
 * this shape will be refined (not widened) once that lands.
 */
export interface AppStateSnapshot {
  color: "green" | "amber" | "red" | "gray";
  instances: unknown[];
}

export interface IpcInvokeMap {
  [IPC_CHANNELS.refresh]: (instanceId?: string) => Promise<void>;
  [IPC_CHANNELS.getState]: () => Promise<AppStateSnapshot>;
  [IPC_CHANNELS.openSettings]: () => Promise<void>;
  [IPC_CHANNELS.addAccount]: (providerId: ProviderInstance["providerId"]) => Promise<void>;
  [IPC_CHANNELS.getSettings]: () => Promise<Settings>;
  [IPC_CHANNELS.updateSettings]: (settings: Settings) => Promise<void>;
}

export interface IpcPushMap {
  [IPC_CHANNELS.stateUpdate]: (state: AppStateSnapshot) => void;
}

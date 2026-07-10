// Typed IPC channel map (design D3). Renderer -> main uses `invoke`;
// main -> renderer uses a one-way push on `state:update`.
import type { ProviderInstance, QuotaWindow, Settings } from "./domain";

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
 * View-model for a single provider instance as pushed to the renderer on
 * `state:update`. Mirrors `InstanceSnapshot` from `src/core/aggregate.ts`
 * (which lives in core and therefore cannot be imported by shared).
 */
export type InstanceViewModelStatus = "healthy" | "auth-expired" | "network" | "provider-broken" | "unconfigured";

export interface InstanceViewModel {
  instanceId: string;
  label: string;
  enabled: boolean;
  status: InstanceViewModelStatus;
  windows: QuotaWindow[];
}

/**
 * Authoritative shape of the state pushed to the renderer on `state:update`.
 * Extends the tray color/tooltip contract from `src/core/aggregate.ts` with
 * the per-instance view-models the popup needs to render cards.
 */
export interface AppStateSnapshot {
  color: "green" | "amber" | "red" | "gray";
  tooltip: string;
  instances: InstanceViewModel[];
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

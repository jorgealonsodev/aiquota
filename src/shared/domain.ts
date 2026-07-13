// Shared domain contracts used across main, preload, and renderer.
// These types are the ports-and-adapters boundary (design D1): the core
// domain (Phase 2) and provider adapters (Phase 3) depend on these shapes,
// never on Electron APIs directly.

/**
 * Well-known quota window kinds. Providers may report additional kinds
 * (e.g. Codex `additional_rate_limits`) using their own string identifiers;
 * `QuotaWindow.kind` is intentionally a plain string to allow that.
 */
export const WINDOW_KIND = {
  FiveHour: "five_hour",
  SevenDay: "seven_day",
} as const;

export type WellKnownWindowKind = (typeof WINDOW_KIND)[keyof typeof WINDOW_KIND];

export interface QuotaWindow {
  /** Well-known kind (see WINDOW_KIND) or a provider-specific identifier. */
  kind: string;
  label: string;
  /** Utilization percentage, 0-100. */
  utilization: number;
  /** ISO timestamp of the next reset, or null if unknown. */
  resetsAt: string | null;
}

export type AuthStatus = "healthy" | "auth-expired" | "unconfigured";

/**
 * Thrown by QuotaProvider.fetchQuota/authStatus/configure on failure
 * (design D5 error taxonomy). `message` is mandatory so every catch site has
 * a human-readable reason, not just a machine-readable `kind`.
 */
export class TypedError extends Error {
  constructor(
    readonly kind: "auth-expired" | "network" | "provider-broken" | "credential-broken",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TypedError";
  }
}

export interface ProviderInstance {
  instanceId: string;
  providerId: "codex" | "claude";
  label: string;
  /** Key used to look up this instance's secrets in the SecretStore. */
  credentialsRef: string;
}

export interface QuotaProvider {
  readonly providerId: "codex" | "claude";
  configure(instance: ProviderInstance): Promise<void>;
  /** Resolves with the current windows, or throws a TypedError. */
  fetchQuota(instance: ProviderInstance): Promise<QuotaWindow[]>;
  authStatus(instance: ProviderInstance): Promise<AuthStatus>;
}

export interface SettingsInstance extends ProviderInstance {
  enabled: boolean;
  /** Resolved Claude organization ID. Not a secret. */
  orgId?: string;
}

export interface Settings {
  instances: SettingsInstance[];
  pollIntervalMinutes: number;
  thresholds: number[];
}

/** Polling-scheduler spec's 1-60 minute bounds. Shared by core/settings.ts (validation) and the renderer settings form (input bounds). */
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 60;

/** Default settings per the app-settings spec. Shared by core/settings.ts (validation fallback) and the renderer settings form (initial state). */
export const DEFAULT_SETTINGS: Settings = {
  instances: [],
  pollIntervalMinutes: 5,
  thresholds: [80, 95],
};

/**
 * Status of a single provider instance as seen by the tray/popup, folding
 * together QuotaProvider.authStatus() ("healthy" | "auth-expired" |
 * "unconfigured") and TypedError.kind ("network" | "provider-broken") into
 * one field. Single source of truth for both `src/core/aggregate.ts`
 * (tray aggregation) and `src/shared/ipc.ts` (renderer view-model) — see
 * design.md "aggregate() Tray Contract".
 */
export type InstanceStatus = "healthy" | "auth-expired" | "network" | "provider-broken" | "unconfigured";

export interface InstanceSnapshot {
  instanceId: string;
  label: string;
  enabled: boolean;
  status: InstanceStatus;
  /** Only meaningful when status is "healthy"; empty otherwise. */
  windows: QuotaWindow[];
}

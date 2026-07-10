// Shared domain contracts used across main, preload, and renderer.
// These types are the ports-and-adapters boundary (design D1): the core
// domain (Phase 2) and provider adapters (Phase 3) depend on these shapes,
// never on Electron APIs directly.

/**
 * Well-known quota window kinds. Providers may report additional kinds
 * (e.g. Codex `additional_rate_limits`) using their own string identifiers;
 * `QuotaWindow.kind` is intentionally a plain string to allow that.
 */
export const WK = {
  FiveHour: "five_hour",
  SevenDay: "seven_day",
} as const;

export type WellKnownWindowKind = (typeof WK)[keyof typeof WK];

export interface QuotaWindow {
  /** Well-known kind (see WK) or a provider-specific identifier. */
  kind: string;
  label: string;
  /** Utilization percentage, 0-100. */
  utilization: number;
  /** ISO timestamp of the next reset, or null if unknown. */
  resetsAt: string | null;
}

export type AuthStatus = "healthy" | "auth-expired" | "unconfigured";

export interface TypedError {
  kind: "auth-expired" | "network" | "provider-broken";
  status?: number;
  message?: string;
}

export interface ProviderInstance {
  instanceId: string;
  providerId: "codex" | "claude";
  label: string;
  /** Key used to look up this instance's secrets in the SecretStore. */
  credentialsRef: string;
}

export interface QuotaProvider {
  providerId: "codex" | "claude";
  configure(): Promise<void>;
  /** Resolves with the current windows, or throws a TypedError. */
  fetchQuota(): Promise<QuotaWindow[]>;
  authStatus(): Promise<AuthStatus>;
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

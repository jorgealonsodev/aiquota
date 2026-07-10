// Pure settings schema validation (design.md D8 / "Settings (app-settings)";
// app-settings + polling-scheduler specs). The electron shell (Phase 3,
// src/main/adapters/electron/settingsStore.ts) reads/writes
// userData/settings.json and calls parseSettings() on the raw JSON.
import type { Settings, SettingsInstance } from "../shared/domain";

export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 60;

export const DEFAULT_SETTINGS: Settings = {
  instances: [],
  pollIntervalMinutes: 5,
  thresholds: [80, 95],
};

/** Clamps a poll interval to the polling-scheduler spec's 1-60 minute bounds. */
export function clampInterval(minutes: number): number {
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, minutes));
}

function isValidSettingsInstance(raw: unknown): raw is SettingsInstance {
  if (typeof raw !== "object" || raw === null) return false;
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.instanceId === "string" &&
    (candidate.providerId === "codex" || candidate.providerId === "claude") &&
    typeof candidate.label === "string" &&
    typeof candidate.credentialsRef === "string" &&
    typeof candidate.enabled === "boolean" &&
    (candidate.orgId === undefined || typeof candidate.orgId === "string")
  );
}

function isValidSettingsShape(raw: unknown): raw is Settings {
  if (typeof raw !== "object" || raw === null) return false;
  const candidate = raw as Record<string, unknown>;

  return (
    Array.isArray(candidate.instances) &&
    candidate.instances.every(isValidSettingsInstance) &&
    typeof candidate.pollIntervalMinutes === "number" &&
    Array.isArray(candidate.thresholds) &&
    candidate.thresholds.every((threshold) => typeof threshold === "number")
  );
}

function cloneDefaults(): Settings {
  return {
    instances: [...DEFAULT_SETTINGS.instances],
    pollIntervalMinutes: DEFAULT_SETTINGS.pollIntervalMinutes,
    thresholds: [...DEFAULT_SETTINGS.thresholds],
  };
}

/**
 * Validates a raw settings.json payload. On any shape/type mismatch
 * (corruption, missing fields, malformed nested instance), falls back to
 * DEFAULT_SETTINGS entirely rather than attempting partial recovery — this
 * matches design.md D8's "validated on load, defaults on corruption".
 */
export function parseSettings(raw: unknown): Settings {
  if (!isValidSettingsShape(raw)) {
    return cloneDefaults();
  }

  return {
    instances: raw.instances,
    pollIntervalMinutes: clampInterval(raw.pollIntervalMinutes),
    thresholds: raw.thresholds,
  };
}

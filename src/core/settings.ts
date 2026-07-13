// Pure settings schema validation (design.md D8 / "Settings (app-settings)";
// app-settings + polling-scheduler specs). The electron shell (Phase 3,
// src/main/adapters/electron/settingsStore.ts) reads/writes
// userData/settings.json and calls parseSettings() on the raw JSON.
import { DEFAULT_SETTINGS, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from "../shared/domain";
import type { Settings, SettingsInstance } from "../shared/domain";

/**
 * MIN_INTERVAL_MINUTES/MAX_INTERVAL_MINUTES/DEFAULT_SETTINGS are defined in
 * `src/shared/domain.ts` (the single source of truth also used by the
 * renderer settings form) and re-exported here for backward-compatible
 * imports from `./settings`.
 */
export { DEFAULT_SETTINGS, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES };

/** Notification threshold bounds: exclusive 0, inclusive 100 (a percentage). */
const MIN_THRESHOLD = 0;
const MAX_THRESHOLD = 100;

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
 * Copies only the known SettingsInstance fields onto a fresh object — an
 * explicit allow-list, not a spread of the raw object. This strips any
 * unexpected extra field (e.g. a leaked `token`) and guarantees the
 * caller never receives a reference to the raw JSON object.
 */
function toSettingsInstance(instance: SettingsInstance): SettingsInstance {
  const picked: SettingsInstance = {
    instanceId: instance.instanceId,
    providerId: instance.providerId,
    label: instance.label,
    credentialsRef: instance.credentialsRef,
    enabled: instance.enabled,
  };
  if (instance.orgId !== undefined) {
    picked.orgId = instance.orgId;
  }
  return picked;
}

/**
 * Keeps only finite thresholds within (0, 100]. If none remain, falls
 * back to the default thresholds — always a fresh array, never the raw
 * reference.
 */
function sanitizeThresholds(rawThresholds: number[]): number[] {
  const valid = rawThresholds.filter(
    (value) => Number.isFinite(value) && value > MIN_THRESHOLD && value <= MAX_THRESHOLD,
  );
  return valid.length > 0 ? valid : [...DEFAULT_SETTINGS.thresholds];
}

/**
 * Validates a raw settings.json payload. On any shape/type mismatch
 * (corruption, missing fields, malformed nested instance), falls back to
 * DEFAULT_SETTINGS entirely rather than attempting partial recovery — this
 * matches design.md D8's "validated on load, defaults on corruption".
 *
 * When the shape IS valid, every field is copied onto a fresh object via
 * an explicit allow-list (never a reference to the raw JSON), and
 * thresholds are individually sanitized to (0, 100].
 */
export function parseSettings(raw: unknown): Settings {
  if (!isValidSettingsShape(raw)) {
    return cloneDefaults();
  }

  return {
    instances: raw.instances.map(toSettingsInstance),
    pollIntervalMinutes: clampInterval(raw.pollIntervalMinutes),
    thresholds: sanitizeThresholds(raw.thresholds),
  };
}

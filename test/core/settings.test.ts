import { describe, expect, it } from "vitest";
import { clampInterval, DEFAULT_SETTINGS, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, parseSettings } from "../../src/core/settings";

describe("settings schema validation (app-settings spec)", () => {
  it("passes through a well-formed settings document unchanged", () => {
    const raw = {
      instances: [{ instanceId: "codex-1", providerId: "codex", label: "Personal", credentialsRef: "codex-1", enabled: true }],
      pollIntervalMinutes: 10,
      thresholds: [80, 95],
    };

    expect(parseSettings(raw)).toEqual(raw);
  });

  it("falls back to defaults when the document is not an object", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("corrupted")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults when a required top-level field is missing or the wrong type", () => {
    expect(parseSettings({ instances: [], thresholds: [80, 95] })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ instances: "not-an-array", pollIntervalMinutes: 5, thresholds: [80, 95] })).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults when a nested instance entry is malformed", () => {
    const raw = {
      instances: [{ instanceId: "codex-1", providerId: "unknown-provider", label: "Personal", credentialsRef: "codex-1", enabled: true }],
      pollIntervalMinutes: 5,
      thresholds: [80, 95],
    };

    expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps pollIntervalMinutes below the minimum bound", () => {
    const raw = { instances: [], pollIntervalMinutes: 0, thresholds: [80, 95] };

    expect(parseSettings(raw).pollIntervalMinutes).toBe(MIN_INTERVAL_MINUTES);
  });

  it("clamps pollIntervalMinutes above the maximum bound", () => {
    const raw = { instances: [], pollIntervalMinutes: 120, thresholds: [80, 95] };

    expect(parseSettings(raw).pollIntervalMinutes).toBe(MAX_INTERVAL_MINUTES);
  });

  it("exposes clampInterval() directly for the settings-update IPC path", () => {
    expect(clampInterval(-5)).toBe(1);
    expect(clampInterval(30)).toBe(30);
    expect(clampInterval(999)).toBe(60);
  });
});

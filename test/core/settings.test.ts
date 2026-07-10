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

  it("strips unknown extra fields from parsed instances via an explicit allow-list", () => {
    const raw = {
      instances: [
        {
          instanceId: "codex-1",
          providerId: "codex",
          label: "Personal",
          credentialsRef: "codex-1",
          enabled: true,
          token: "leaked-secret",
        },
      ],
      pollIntervalMinutes: 5,
      thresholds: [80, 95],
    };

    const parsed = parseSettings(raw);

    expect(parsed.instances[0]).toEqual({
      instanceId: "codex-1",
      providerId: "codex",
      label: "Personal",
      credentialsRef: "codex-1",
      enabled: true,
    });
    expect(parsed.instances[0]).not.toHaveProperty("token");
  });

  it("never returns the raw settings object or its nested instances by reference", () => {
    const raw = {
      instances: [{ instanceId: "codex-1", providerId: "codex", label: "Personal", credentialsRef: "codex-1", enabled: true }],
      pollIntervalMinutes: 5,
      thresholds: [80, 95],
    };

    const parsed = parseSettings(raw);

    expect(parsed).not.toBe(raw);
    expect(parsed.instances[0]).not.toBe(raw.instances[0]);
    expect(parsed.thresholds).not.toBe(raw.thresholds);
  });

  it("preserves an instance's optional orgId when present via the allow-list", () => {
    const raw = {
      instances: [
        { instanceId: "claude-1", providerId: "claude", label: "Work", credentialsRef: "claude-1", enabled: true, orgId: "org-123" },
      ],
      pollIntervalMinutes: 5,
      thresholds: [80, 95],
    };

    expect(parseSettings(raw).instances[0].orgId).toBe("org-123");
  });

  it("falls back to the default thresholds when every configured value is invalid", () => {
    const raw = { instances: [], pollIntervalMinutes: 5, thresholds: [-5, 500] };

    expect(parseSettings(raw).thresholds).toEqual([80, 95]);
  });

  it("keeps only the valid thresholds when at least one is in (0, 100]", () => {
    const raw = { instances: [], pollIntervalMinutes: 5, thresholds: [80, 950] };

    expect(parseSettings(raw).thresholds).toEqual([80]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Settings } from "../../src/renderer/Settings";
import type { Settings as SettingsType, SettingsInstance } from "../../src/shared/domain";
import type { ElectronAPI } from "../../src/preload/index";

function settingsInstance(overrides: Partial<SettingsInstance> = {}): SettingsInstance {
  return {
    instanceId: "claude-1",
    providerId: "claude",
    label: "Claude Personal",
    credentialsRef: "claude-1",
    enabled: true,
    orgId: "org-abc",
    ...overrides,
  };
}

function fakeApi(initial: SettingsType): ElectronAPI {
  return {
    refresh: vi.fn(),
    getState: vi.fn(),
    openSettings: vi.fn(),
    addAccount: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(initial),
    updateSettings: vi.fn(),
    onStateUpdate: vi.fn(() => vi.fn()),
  } as unknown as ElectronAPI;
}

describe("Settings (app-settings spec)", () => {
  it("renders provider toggles and labels", () => {
    const api = fakeApi({
      instances: [],
      pollIntervalMinutes: 5,
      thresholds: [80, 95],
    });

    const html = renderToStaticMarkup(
      <Settings
        api={api}
        initialSettings={{
          instances: [settingsInstance(), settingsInstance({ instanceId: "codex-1", providerId: "codex", label: "Codex CLI", orgId: undefined })],
          pollIntervalMinutes: 5,
          thresholds: [80, 95],
        }}
      />,
    );

    expect(html).toContain("Claude Personal");
    expect(html).toContain("Codex CLI");
    expect(html).toContain("enabled");
  });

  it("renders the poll interval control", () => {
    const api = fakeApi({ instances: [], pollIntervalMinutes: 5, thresholds: [80] });

    const html = renderToStaticMarkup(<Settings api={api} initialSettings={{ instances: [], pollIntervalMinutes: 10, thresholds: [80] }} />);

    expect(html).toContain("10");
    expect(html).toContain("minutes");
  });

  it("renders threshold inputs", () => {
    const api = fakeApi({ instances: [], pollIntervalMinutes: 5, thresholds: [80, 95] });

    const html = renderToStaticMarkup(<Settings api={api} initialSettings={{ instances: [], pollIntervalMinutes: 5, thresholds: [80, 95] }} />);

    expect(html).toContain("80");
    expect(html).toContain("95");
  });

  it("renders a manual org-ID field for Claude instances", () => {
    const api = fakeApi({
      instances: [],
      pollIntervalMinutes: 5,
      thresholds: [80],
    });

    const html = renderToStaticMarkup(
      <Settings
        api={api}
        initialSettings={{
          instances: [settingsInstance({ orgId: "manual-org" })],
          pollIntervalMinutes: 5,
          thresholds: [80],
        }}
      />,
    );

    expect(html).toContain("manual-org");
    expect(html).toContain("Organization ID");
  });

  it("renders a save button", () => {
    const api = fakeApi({ instances: [], pollIntervalMinutes: 5, thresholds: [80] });

    const html = renderToStaticMarkup(<Settings api={api} initialSettings={{ instances: [], pollIntervalMinutes: 5, thresholds: [80] }} />);

    expect(html).toContain("Save");
  });

  it("renders an add-account control for every supported provider", () => {
    const api = fakeApi({ instances: [], pollIntervalMinutes: 5, thresholds: [80] });

    const html = renderToStaticMarkup(<Settings api={api} initialSettings={{ instances: [], pollIntervalMinutes: 5, thresholds: [80] }} />);

    expect(html).toContain("Add Codex account");
    expect(html).toContain("Add Claude account");
  });

  it("disables the add-account button once an instance for that provider exists (MVP one-instance-per-provider limit)", () => {
    const api = fakeApi({ instances: [], pollIntervalMinutes: 5, thresholds: [80] });

    const html = renderToStaticMarkup(
      <Settings
        api={api}
        initialSettings={{
          instances: [settingsInstance({ instanceId: "claude-1", providerId: "claude" })],
          pollIntervalMinutes: 5,
          thresholds: [80],
        }}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*Add Claude account/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\s*Add Codex account/);
  });
});

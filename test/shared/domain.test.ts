import { describe, expect, it } from "vitest";
import { WK } from "../../src/shared/domain";
import type {
  AuthStatus,
  ProviderInstance,
  QuotaProvider,
  QuotaWindow,
  Settings,
  SettingsInstance,
  TypedError,
} from "../../src/shared/domain";

describe("shared domain contracts", () => {
  it("exposes stable window-kind constants for the 5-hour window", () => {
    expect(WK.FiveHour).toBe("five_hour");
  });

  it("exposes stable window-kind constants for the 7-day window", () => {
    expect(WK.SevenDay).toBe("seven_day");
  });

  it("shapes a QuotaWindow that reflects a real provider reading", () => {
    const window: QuotaWindow = {
      kind: WK.FiveHour,
      label: "Last 5 hours",
      utilization: 42,
      resetsAt: "2026-07-10T12:00:00.000Z",
    };

    expect(window.kind).toBe("five_hour");
    expect(window.utilization).toBe(42);
  });

  it("shapes a TypedError distinguishing auth-expired from provider-broken", () => {
    const authExpired: TypedError = { kind: "auth-expired", status: 401 };
    const providerBroken: TypedError = { kind: "provider-broken", status: 503 };

    expect(authExpired.kind).toBe("auth-expired");
    expect(providerBroken.kind).toBe("provider-broken");
    expect(authExpired.kind).not.toBe(providerBroken.kind);
  });

  it("shapes a ProviderInstance and a SettingsInstance extending it", () => {
    const instance: ProviderInstance = {
      instanceId: "codex-1",
      providerId: "codex",
      label: "Personal Codex",
      credentialsRef: "codex-1",
    };
    const settingsInstance: SettingsInstance = {
      ...instance,
      enabled: true,
      orgId: undefined,
    };

    expect(settingsInstance.instanceId).toBe(instance.instanceId);
    expect(settingsInstance.enabled).toBe(true);
  });

  it("shapes Settings with instances, poll interval, and thresholds", () => {
    const settings: Settings = {
      instances: [],
      pollIntervalMinutes: 5,
      thresholds: [80, 95],
    };

    expect(settings.pollIntervalMinutes).toBe(5);
    expect(settings.thresholds).toEqual([80, 95]);
  });

  it("allows a fake QuotaProvider and AuthStatus to satisfy the contract", async () => {
    const status: AuthStatus = "healthy";
    const fakeProvider: QuotaProvider = {
      providerId: "claude",
      configure: async () => undefined,
      fetchQuota: async () => [
        { kind: WK.SevenDay, label: "Last 7 days", utilization: 10, resetsAt: null },
      ],
      authStatus: async () => status,
    };

    const windows = await fakeProvider.fetchQuota();
    const resolvedStatus = await fakeProvider.authStatus();

    expect(windows).toHaveLength(1);
    expect(windows[0].kind).toBe("seven_day");
    expect(resolvedStatus).toBe("healthy");
  });
});

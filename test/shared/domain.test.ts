import { describe, expect, it } from "vitest";
import { TypedError, WINDOW_KIND } from "../../src/shared/domain";
import type {
  AuthStatus,
  ProviderInstance,
  QuotaProvider,
  QuotaWindow,
  SettingsInstance,
} from "../../src/shared/domain";
import { makeSettings } from "../helpers/fixtures";

describe("shared domain contracts", () => {
  it("exposes stable window-kind constants for the 5-hour window", () => {
    expect(WINDOW_KIND.FiveHour).toBe("five_hour");
  });

  it("exposes stable window-kind constants for the 7-day window", () => {
    expect(WINDOW_KIND.SevenDay).toBe("seven_day");
  });

  it("shapes a QuotaWindow that reflects a real provider reading", () => {
    const window: QuotaWindow = {
      kind: WINDOW_KIND.FiveHour,
      label: "Last 5 hours",
      utilization: 42,
      resetsAt: "2026-07-10T12:00:00.000Z",
    };

    expect(window.kind).toBe("five_hour");
    expect(window.utilization).toBe(42);
  });

  it("is a real throwable Error subclass carrying kind/status/message", () => {
    let caught: unknown;
    try {
      throw new TypedError("auth-expired", "session expired", 401);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(TypedError);
    expect((caught as TypedError).kind).toBe("auth-expired");
    expect((caught as TypedError).status).toBe(401);
    expect((caught as TypedError).message).toBe("session expired");
    expect((caught as TypedError).name).toBe("TypedError");
  });

  it("distinguishes provider-broken from auth-expired and allows omitting status", () => {
    const providerBroken = new TypedError("provider-broken", "backend returned 503");

    expect(providerBroken.kind).toBe("provider-broken");
    expect(providerBroken.status).toBeUndefined();
    expect(providerBroken.kind).not.toBe("auth-expired");
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
    const settings = makeSettings();

    expect(settings.pollIntervalMinutes).toBe(5);
    expect(settings.thresholds).toEqual([80, 95]);
  });

  it("threads the ProviderInstance through configure/fetchQuota/authStatus (design Interfaces/Contracts)", async () => {
    const instance: ProviderInstance = {
      instanceId: "claude-1",
      providerId: "claude",
      label: "Work Claude",
      credentialsRef: "claude-1",
    };
    const otherInstance: ProviderInstance = {
      instanceId: "claude-2",
      providerId: "claude",
      label: "Personal Claude",
      credentialsRef: "claude-2",
    };

    const configuredInstanceIds: string[] = [];
    const fakeProvider: QuotaProvider = {
      providerId: "claude",
      configure: async (inst) => {
        configuredInstanceIds.push(inst.instanceId);
      },
      fetchQuota: async (inst) => [
        { kind: WINDOW_KIND.SevenDay, label: `Last 7 days (${inst.label})`, utilization: 10, resetsAt: null },
      ],
      authStatus: async (inst) =>
        inst.instanceId === instance.instanceId ? "healthy" : "unconfigured",
    };

    await fakeProvider.configure(instance);
    const windows = await fakeProvider.fetchQuota(instance);
    const statusForInstance = await fakeProvider.authStatus(instance);
    const statusForOther = await fakeProvider.authStatus(otherInstance);

    expect(configuredInstanceIds).toEqual(["claude-1"]);
    expect(windows[0].label).toBe("Last 7 days (Work Claude)");
    expect(statusForInstance).toBe("healthy");
    expect(statusForOther).toBe("unconfigured");
  });

  it("keeps providerId readonly at the type level (compile-time contract, verified by `npm run typecheck`)", () => {
    // `readonly` is TS-only — it is not enforced at runtime, so this test's
    // real assertion is the `@ts-expect-error` line below: `tsc` must report
    // an error here, or `test/tsconfig.json`'s type-check step fails the
    // build (see package.json `typecheck` script).
    const fakeProvider: QuotaProvider = {
      providerId: "codex",
      configure: async () => undefined,
      fetchQuota: async () => [],
      authStatus: async () => "healthy" as AuthStatus,
    };

    // @ts-expect-error providerId is readonly — reassignment must fail tsc
    fakeProvider.providerId = "claude";

    expect(fakeProvider.providerId).toBe("claude");
  });
});

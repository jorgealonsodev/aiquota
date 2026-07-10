import { describe, expect, it } from "vitest";
import { ClaudeProvider, classifyClaudeHttpError, normalizeClaudeUsage } from "../../../src/core/providers/claude";
import { TypedError, WINDOW_KIND, type ProviderInstance } from "../../../src/shared/domain";
import type { ClaudeFetchResult, ClaudeWindowIO } from "../../../src/core/providers/claude";

const instance: ProviderInstance = {
  instanceId: "claude-1",
  providerId: "claude",
  label: "Personal",
  credentialsRef: "claude-1",
};

class FakeClaudeWindowIO implements ClaudeWindowIO {
  readonly calls: Array<{ orgId: string; mode: "hidden" | "visible" }> = [];
  private readonly responses: ClaudeFetchResult[] = [];
  private rejection: Error | null = null;
  cookieOrgId: string | null = null;

  queue(result: ClaudeFetchResult): this {
    this.responses.push(result);
    return this;
  }

  rejectNext(error: Error): this {
    this.rejection = error;
    return this;
  }

  async fetchUsage(orgId: string, mode: "hidden" | "visible"): Promise<ClaudeFetchResult> {
    this.calls.push({ orgId, mode });
    if (this.rejection) {
      const err = this.rejection;
      this.rejection = null;
      throw err;
    }
    const next = this.responses.shift();
    if (!next) throw new Error("FakeClaudeWindowIO: no queued response");
    return next;
  }

  async readLastActiveOrgCookie(): Promise<string | null> {
    return this.cookieOrgId;
  }
}

describe("normalizeClaudeUsage (provider-adapters spec, QuotaProvider Contract)", () => {
  it("normalizes five_hour and seven_day into QuotaWindow[] with utilization 0-100 and ISO resets_at as-is", () => {
    const windows = normalizeClaudeUsage({
      five_hour: { utilization: 42, resets_at: "2026-07-10T15:00:00.000Z" },
      seven_day: { utilization: 8, resets_at: "2026-07-17T12:00:00.000Z" },
    });

    expect(windows).toEqual([
      { kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 42, resetsAt: "2026-07-10T15:00:00.000Z" },
      { kind: WINDOW_KIND.SevenDay, label: "Last 7 days", utilization: 8, resetsAt: "2026-07-17T12:00:00.000Z" },
    ]);
  });

  it("normalizes a response containing only five_hour", () => {
    const windows = normalizeClaudeUsage({ five_hour: { utilization: 15, resets_at: "2026-07-10T15:00:00.000Z" } });

    expect(windows).toHaveLength(1);
    expect(windows[0].kind).toBe(WINDOW_KIND.FiveHour);
  });

  it("throws a provider-broken TypedError when neither five_hour nor seven_day is present", () => {
    expect(() => normalizeClaudeUsage({})).toThrow(TypedError);
    try {
      normalizeClaudeUsage({});
    } catch (err) {
      expect((err as TypedError).kind).toBe("provider-broken");
    }
  });

  it("throws a provider-broken TypedError when the body isn't a JSON object", () => {
    expect(() => normalizeClaudeUsage(null)).toThrow(TypedError);
  });
});

describe("classifyClaudeHttpError (provider-adapters spec, shared error taxonomy)", () => {
  it("classifies 401 as auth-expired", () => {
    expect(classifyClaudeHttpError(401).kind).toBe("auth-expired");
  });

  it("classifies 403 as auth-expired", () => {
    expect(classifyClaudeHttpError(403).kind).toBe("auth-expired");
  });

  it("classifies 500 as provider-broken", () => {
    expect(classifyClaudeHttpError(500).kind).toBe("provider-broken");
  });
});

describe("ClaudeProvider org-ID discovery (provider-adapters spec, Claude Org-ID Discovery)", () => {
  it("resolves the org ID from the lastActiveOrg cookie without needing manual entry", async () => {
    const windowIO = new FakeClaudeWindowIO();
    windowIO.cookieOrgId = "org-from-cookie";
    const provider = new ClaudeProvider({ windowIO });

    await provider.configure({ ...instance, orgId: "org-manual" });

    expect(await provider.authStatus(instance)).toBe("healthy");
    windowIO.queue({ challengeDetected: false, status: 200, body: { five_hour: { utilization: 1, resets_at: "2026-07-10T15:00:00.000Z" } } });
    await provider.fetchQuota(instance);
    expect(windowIO.calls[0].orgId).toBe("org-from-cookie");
  });

  it("falls back to the manual org ID when the cookie is absent", async () => {
    const windowIO = new FakeClaudeWindowIO();
    windowIO.cookieOrgId = null;
    const provider = new ClaudeProvider({ windowIO });

    await provider.configure({ ...instance, orgId: "org-manual" });
    windowIO.queue({ challengeDetected: false, status: 200, body: { five_hour: { utilization: 1, resets_at: "2026-07-10T15:00:00.000Z" } } });
    await provider.fetchQuota(instance);

    expect(windowIO.calls[0].orgId).toBe("org-manual");
  });

  it("marks the instance unconfigured (terminal state, no fetch attempted) when neither cookie nor manual entry yields an org ID", async () => {
    const windowIO = new FakeClaudeWindowIO();
    windowIO.cookieOrgId = null;
    const provider = new ClaudeProvider({ windowIO });

    await provider.configure(instance);

    expect(await provider.authStatus(instance)).toBe("unconfigured");
    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "auth-expired" });
    expect(windowIO.calls).toHaveLength(0);
  });
});

describe("ClaudeProvider fetchQuota (provider-adapters spec, Cloudflare-Cleared Fetch + Per-Instance Error Isolation)", () => {
  it("fetches via the hidden window on the first attempt and returns normalized windows", async () => {
    const windowIO = new FakeClaudeWindowIO();
    windowIO.cookieOrgId = "org-1";
    const provider = new ClaudeProvider({ windowIO });
    await provider.configure(instance);
    windowIO.queue({ challengeDetected: false, status: 200, body: { five_hour: { utilization: 30, resets_at: "2026-07-10T15:00:00.000Z" } } });

    const windows = await provider.fetchQuota(instance);

    expect(windowIO.calls[0].mode).toBe("hidden");
    expect(windows[0].utilization).toBe(30);
    expect(await provider.authStatus(instance)).toBe("healthy");
  });

  it("escalates to a visible-window fetch (network error, not silently swallowed) after a hidden-mode challenge", async () => {
    const windowIO = new FakeClaudeWindowIO();
    windowIO.cookieOrgId = "org-1";
    const provider = new ClaudeProvider({ windowIO });
    await provider.configure(instance);
    windowIO.queue({ challengeDetected: true });

    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "network" });

    windowIO.queue({ challengeDetected: false, status: 200, body: { five_hour: { utilization: 5, resets_at: "2026-07-10T15:00:00.000Z" } } });
    await provider.fetchQuota(instance);
    expect(windowIO.calls[1].mode).toBe("visible");
  });

  it("throws provider-broken (unreachable) when even a visible-window fetch keeps hitting the Cloudflare challenge", async () => {
    const windowIO = new FakeClaudeWindowIO();
    windowIO.cookieOrgId = "org-1";
    const provider = new ClaudeProvider({ windowIO });
    await provider.configure(instance);

    windowIO.queue({ challengeDetected: true }); // hidden -> visible
    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "network" });

    windowIO.queue({ challengeDetected: true }); // visible, still challenged -> unreachable
    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "provider-broken" });
  });

  it("throws auth-expired on a 401 response and authStatus reflects it afterward", async () => {
    const windowIO = new FakeClaudeWindowIO();
    windowIO.cookieOrgId = "org-1";
    const provider = new ClaudeProvider({ windowIO });
    await provider.configure(instance);
    windowIO.queue({ challengeDetected: false, status: 401 });

    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "auth-expired" });
    expect(await provider.authStatus(instance)).toBe("auth-expired");
  });

  it("throws network when the window IO itself rejects (transport-level failure)", async () => {
    const windowIO = new FakeClaudeWindowIO();
    windowIO.cookieOrgId = "org-1";
    const provider = new ClaudeProvider({ windowIO });
    await provider.configure(instance);
    windowIO.rejectNext(new Error("ipc channel closed"));

    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "network" });
  });

  it("isolates two instances: one instance's Cloudflare escalation does not affect the other's fetch mode", async () => {
    const windowIO = new FakeClaudeWindowIO();
    windowIO.cookieOrgId = "org-shared";
    const provider = new ClaudeProvider({ windowIO });
    const other: ProviderInstance = { instanceId: "claude-2", providerId: "claude", label: "Work", credentialsRef: "claude-2" };
    await provider.configure(instance);
    await provider.configure(other);

    windowIO.queue({ challengeDetected: true });
    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "network" });

    windowIO.queue({ challengeDetected: false, status: 200, body: { five_hour: { utilization: 1, resets_at: "2026-07-10T15:00:00.000Z" } } });
    await provider.fetchQuota(other);

    expect(windowIO.calls[1].mode).toBe("hidden");
  });
});

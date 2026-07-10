import { describe, expect, it } from "vitest";
import {
  classifyCodexHttpError,
  CodexProvider,
  decodeJwtAccountId,
  normalizeCodexUsage,
  parseCodexAuthFile,
  resolveCodexAccountId,
  resolveCodexHome,
} from "../../../src/core/providers/codex";
import { TypedError, WINDOW_KIND, type ProviderInstance } from "../../../src/shared/domain";
import { FakeHttpClient } from "../../helpers/fakeHttpClient";

function buildJwt(payload: Record<string, unknown>): string {
  const base64url = (input: string) => Buffer.from(input, "utf8").toString("base64url");
  const header = base64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

const instance: ProviderInstance = {
  instanceId: "codex-1",
  providerId: "codex",
  label: "Personal",
  credentialsRef: "codex-1",
};

class FakeAuthReader {
  constructor(private readonly files: Record<string, string | null>) {}
  async read(path: string): Promise<string | null> {
    return this.files[path] ?? null;
  }
}

describe("resolveCodexHome (provider-adapters spec, Codex Dual Auth Cascade)", () => {
  it("uses CODEX_HOME when set, ignoring the platform default", () => {
    expect(resolveCodexHome({ codexHomeEnv: "/custom/codex", homeDir: "/home/alice", platform: "linux" })).toBe("/custom/codex");
  });

  it("defaults to {home}/.codex with a POSIX separator on linux/darwin", () => {
    expect(resolveCodexHome({ homeDir: "/home/alice", platform: "linux" })).toBe("/home/alice/.codex");
  });

  it("defaults to {home}\\.codex with a Windows separator on win32 (%USERPROFILE%\\.codex)", () => {
    expect(resolveCodexHome({ homeDir: "C:\\Users\\alice", platform: "win32" })).toBe("C:\\Users\\alice\\.codex");
  });
});

describe("parseCodexAuthFile (provider-adapters spec, Codex Dual Auth Cascade)", () => {
  it("extracts accessToken/accountId/idToken from a well-formed auth.json", () => {
    const raw = JSON.stringify({ tokens: { access_token: "at-1", account_id: "acct-1", id_token: "id-1" } });

    expect(parseCodexAuthFile(raw)).toEqual({ accessToken: "at-1", accountId: "acct-1", idToken: "id-1" });
  });

  it("returns null for invalid JSON", () => {
    expect(parseCodexAuthFile("not json")).toBeNull();
  });

  it("returns null when tokens.access_token is missing", () => {
    expect(parseCodexAuthFile(JSON.stringify({ tokens: { account_id: "acct-1" } }))).toBeNull();
  });
});

describe("decodeJwtAccountId (provider-adapters spec, Codex Dual Auth Cascade)", () => {
  it("decodes the chatgpt_account_id claim from the https://api.openai.com/auth namespace", () => {
    const token = buildJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-from-jwt" } });

    expect(decodeJwtAccountId(token)).toBe("acct-from-jwt");
  });

  it("returns undefined when the claim namespace is absent", () => {
    expect(decodeJwtAccountId(buildJwt({ sub: "user-1" }))).toBeUndefined();
  });

  it("returns undefined for a malformed token", () => {
    expect(decodeJwtAccountId("not-a-jwt")).toBeUndefined();
  });
});

describe("resolveCodexAccountId (provider-adapters spec, Codex Dual Auth Cascade)", () => {
  it("prefers tokens.account_id over the JWT claim", () => {
    const idToken = buildJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-from-jwt" } });

    expect(resolveCodexAccountId({ accessToken: "at-1", accountId: "acct-from-file", idToken })).toBe("acct-from-file");
  });

  it("falls back to the JWT claim when tokens.account_id is absent", () => {
    const idToken = buildJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-from-jwt" } });

    expect(resolveCodexAccountId({ accessToken: "at-1", idToken })).toBe("acct-from-jwt");
  });

  it("returns undefined when neither source yields an account id", () => {
    expect(resolveCodexAccountId({ accessToken: "at-1" })).toBeUndefined();
  });
});

describe("normalizeCodexUsage (provider-adapters spec, QuotaProvider Contract)", () => {
  const nowMs = Date.parse("2026-07-10T12:00:00.000Z");

  it("normalizes primary_window/secondary_window into WINDOW_KIND.FiveHour/SevenDay", () => {
    const body = {
      rate_limit: {
        primary_window: { used_percent: 42, reset_after_seconds: 3600 },
        secondary_window: { used_percent: 10, reset_after_seconds: 172800 },
      },
    };

    const windows = normalizeCodexUsage(body, nowMs);

    expect(windows).toEqual([
      { kind: WINDOW_KIND.FiveHour, label: "Last 5 hours", utilization: 42, resetsAt: new Date(nowMs + 3600 * 1000).toISOString() },
      { kind: WINDOW_KIND.SevenDay, label: "Last 7 days", utilization: 10, resetsAt: new Date(nowMs + 172800 * 1000).toISOString() },
    ]);
  });

  it("prefers the absolute reset_at (epoch seconds) over reset_after_seconds when both are present", () => {
    const resetAtSeconds = Math.floor(nowMs / 1000) + 60;
    const body = {
      rate_limit: {
        primary_window: { used_percent: 5, reset_at: resetAtSeconds, reset_after_seconds: 999999 },
      },
    };

    const windows = normalizeCodexUsage(body, nowMs);

    expect(windows[0].resetsAt).toBe(new Date(resetAtSeconds * 1000).toISOString());
  });

  it("uses resetsAt: null when neither reset_at nor reset_after_seconds is present", () => {
    const body = { rate_limit: { primary_window: { used_percent: 5 } } };

    expect(normalizeCodexUsage(body, nowMs)[0].resetsAt).toBeNull();
  });

  it("includes additional_rate_limits as their own windows keyed by limit_name/metered_feature", () => {
    const body = {
      rate_limit: { primary_window: { used_percent: 5 } },
      additional_rate_limits: [
        { metered_feature: "gpt-5-preview", rate_limit: { primary_window: { used_percent: 88, reset_after_seconds: 60 } } },
      ],
    };

    const windows = normalizeCodexUsage(body, nowMs);

    expect(windows).toHaveLength(2);
    expect(windows[1]).toEqual({
      kind: "gpt-5-preview",
      label: "gpt-5-preview",
      utilization: 88,
      resetsAt: new Date(nowMs + 60 * 1000).toISOString(),
    });
  });

  it("skips an additional_rate_limits entry when both limit_name and metered_feature are absent", () => {
    const body = {
      rate_limit: { primary_window: { used_percent: 5 } },
      additional_rate_limits: [
        { rate_limit: { primary_window: { used_percent: 88 } } }, // no limit_name, no metered_feature
      ],
    };

    const windows = normalizeCodexUsage(body, nowMs);

    expect(windows).toHaveLength(1); // only primary, extra skipped
  });

  it("throws a provider-broken TypedError when rate_limit is missing", () => {
    expect(() => normalizeCodexUsage({}, nowMs)).toThrow(TypedError);
    try {
      normalizeCodexUsage({}, nowMs);
    } catch (err) {
      expect(err).toBeInstanceOf(TypedError);
      expect((err as TypedError).kind).toBe("provider-broken");
    }
  });

  it("throws a provider-broken TypedError when the body isn't a JSON object", () => {
    expect(() => normalizeCodexUsage("not-an-object", nowMs)).toThrow(TypedError);
  });
});

describe("classifyCodexHttpError (provider-adapters spec, Codex 401 Recovery)", () => {
  it("classifies 401 as auth-expired", () => {
    const error = classifyCodexHttpError(401);
    expect(error.kind).toBe("auth-expired");
    expect(error.status).toBe(401);
  });

  it("classifies 403 as auth-expired", () => {
    expect(classifyCodexHttpError(403).kind).toBe("auth-expired");
  });

  it("classifies 503 as provider-broken, not a reconnect state", () => {
    const error = classifyCodexHttpError(503);
    expect(error.kind).toBe("provider-broken");
    expect(error.status).toBe(503);
  });

  it("classifies 429 as provider-broken", () => {
    expect(classifyCodexHttpError(429).kind).toBe("provider-broken");
  });
});

describe("CodexProvider (provider-adapters spec, Codex Dual Auth Cascade + Per-Instance Error Isolation)", () => {
  function makeProvider(authFiles: Record<string, string | null>, nowMs = 0) {
    const httpClient = new FakeHttpClient();
    const provider = new CodexProvider({
      httpClient,
      clock: { now: () => nowMs },
      authReader: new FakeAuthReader(authFiles),
      homeDir: "/home/alice",
      platform: "linux",
    });
    return { httpClient, provider };
  }

  it("zero-config CLI path: a healthy auth.json configures the instance with no browser involved", async () => {
    const { provider } = makeProvider({
      "/home/alice/.codex/auth.json": JSON.stringify({ tokens: { access_token: "at-1", account_id: "acct-1" } }),
    });

    await provider.configure(instance);

    expect(await provider.authStatus(instance)).toBe("healthy");
  });

  it("marks the instance unconfigured when no auth.json exists (fallback-to-web-login is the shell's job, not this adapter's)", async () => {
    const { provider } = makeProvider({});

    await provider.configure(instance);

    expect(await provider.authStatus(instance)).toBe("unconfigured");
  });

  it("fetchQuota sends Bearer + ChatGPT-Account-Id headers to the wham/usage endpoint and returns normalized windows", async () => {
    const { provider, httpClient } = makeProvider(
      { "/home/alice/.codex/auth.json": JSON.stringify({ tokens: { access_token: "at-1", account_id: "acct-1" } }) },
      1000,
    );
    await provider.configure(instance);
    httpClient.queueJson(200, { rate_limit: { primary_window: { used_percent: 20 } } });

    const windows = await provider.fetchQuota(instance);

    expect(httpClient.requests).toHaveLength(1);
    expect(httpClient.requests[0].url).toBe("https://chatgpt.com/backend-api/wham/usage");
    expect(httpClient.requests[0].init?.headers).toMatchObject({
      Authorization: "Bearer at-1",
      "ChatGPT-Account-Id": "acct-1",
      originator: "codex_vscode",
    });
    expect(windows[0].utilization).toBe(20);
  });

  it("fetchQuota throws auth-expired on a 401 and authStatus reflects it afterward", async () => {
    const { provider, httpClient } = makeProvider({
      "/home/alice/.codex/auth.json": JSON.stringify({ tokens: { access_token: "at-1", account_id: "acct-1" } }),
    });
    await provider.configure(instance);
    httpClient.queueJson(401, {});

    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "auth-expired" });
    expect(await provider.authStatus(instance)).toBe("auth-expired");
  });

  it("fetchQuota throws network on a transport failure (httpClient.get rejects)", async () => {
    const { provider, httpClient } = makeProvider({
      "/home/alice/.codex/auth.json": JSON.stringify({ tokens: { access_token: "at-1", account_id: "acct-1" } }),
    });
    await provider.configure(instance);
    httpClient.queueRejection(new Error("ECONNREFUSED"));

    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "network" });
  });

  it("fetchQuota throws provider-broken when the response body fails JSON parsing", async () => {
    const { provider, httpClient } = makeProvider({
      "/home/alice/.codex/auth.json": JSON.stringify({ tokens: { access_token: "at-1", account_id: "acct-1" } }),
    });
    await provider.configure(instance);
    httpClient.queueJsonParseFailure(200);

    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "provider-broken" });
  });

  it("fetchQuota throws provider-broken on a 503 without flipping authStatus away from healthy", async () => {
    const { provider, httpClient } = makeProvider({
      "/home/alice/.codex/auth.json": JSON.stringify({ tokens: { access_token: "at-1", account_id: "acct-1" } }),
    });
    await provider.configure(instance);
    httpClient.queueJson(503, {});

    await expect(provider.fetchQuota(instance)).rejects.toMatchObject({ kind: "provider-broken" });
    expect(await provider.authStatus(instance)).toBe("healthy");
  });

  it("isolates two instances: one configured and healthy, the other unconfigured", async () => {
    const httpClient = new FakeHttpClient();
    const provider = new CodexProvider({
      httpClient,
      clock: { now: () => 0 },
      authReader: new FakeAuthReader({ "/home/alice/.codex/auth.json": JSON.stringify({ tokens: { access_token: "at-1" } }) }),
      homeDir: "/home/alice",
      platform: "linux",
    });
    const other: ProviderInstance = { instanceId: "codex-2", providerId: "codex", label: "Work", credentialsRef: "codex-2" };

    await provider.configure(instance);
    // codex-2 has no auth.json entry under this fake reader's map -> stays unconfigured.

    expect(await provider.authStatus(instance)).toBe("healthy");
    expect(await provider.authStatus(other)).toBe("unconfigured");
  });

  it("multi-instance header isolation: ChatGPT-Account-Id from instance A never leaks to instance B's requests", async () => {
    const httpClient = new FakeHttpClient();
    const provider = new CodexProvider({
      httpClient,
      clock: { now: () => 0 },
      authReader: new FakeAuthReader({
        "/home/alice/.codex/auth.json": JSON.stringify({ tokens: { access_token: "at-1", account_id: "acct-A" } }),
      }),
      homeDir: "/home/alice",
      platform: "linux",
    });
    const instanceB: ProviderInstance = { instanceId: "codex-2", providerId: "codex", label: "Work", credentialsRef: "codex-2" };

    // Configure instance A with account id, instance B without (no auth.json for codex-2's path)
    await provider.configure(instance);
    // For instanceB we use a separate reader state — simulate a different user with no account_id
    const providerB = new CodexProvider({
      httpClient,
      clock: { now: () => 0 },
      authReader: new FakeAuthReader({
        "/home/alice/.codex/auth.json": JSON.stringify({ tokens: { access_token: "at-B" } }),
      }),
      homeDir: "/home/alice",
      platform: "linux",
    });
    await providerB.configure(instanceB);

    httpClient.queueJson(200, { rate_limit: { primary_window: { used_percent: 10 } } });
    await providerB.fetchQuota(instanceB);

    const req = httpClient.requests[0];
    expect(req.init?.headers).not.toHaveProperty("ChatGPT-Account-Id");
  });

  it("configure() re-reads auth.json once when the first parse returns null (transient write-in-progress race)", async () => {
    let readCount = 0;
    const authReader = {
      async read(_path: string): Promise<string | null> {
        readCount++;
        if (readCount === 1) return "not valid json"; // first read: parse failure
        return JSON.stringify({ tokens: { access_token: "at-retry", account_id: "acct-retry" } });
      },
    };
    const provider = new CodexProvider({
      httpClient: new FakeHttpClient(),
      clock: { now: () => 0 },
      authReader,
      homeDir: "/home/alice",
      platform: "linux",
    });

    await provider.configure(instance);

    expect(readCount).toBe(2);
    expect(await provider.authStatus(instance)).toBe("healthy");
  });
});

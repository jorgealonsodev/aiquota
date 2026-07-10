// Codex QuotaProvider adapter (design.md "Adapters" / provider-adapters spec:
// Codex Dual Auth Cascade, Codex 401 Recovery). Pure logic: fetching goes
// through the injected HttpClient, and the auth.json cascade goes through an
// injected AuthReader -- neither touches Node's real fs/network directly, so
// this file has no Electron dependency and is fully unit-testable. The real
// AuthReader/HttpClient wiring lives in src/main/adapters/electron/*.
import path from "node:path";
import type { Clock } from "../scheduler";
import { TypedError, WINDOW_KIND, type AuthStatus, type ProviderInstance, type QuotaProvider, type QuotaWindow } from "../../shared/domain";
import type { HttpClient } from "./httpClient";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_ORIGINATOR = "codex_vscode";
// Non-standard header sent by the official Codex CLI; must be lowercase to
// match the exact casing the ChatGPT backend expects.
const ORIGINATOR_HEADER = "originator" as const;

/** Reads the raw contents of a file, or null if it doesn't exist / can't be read. */
export interface CodexAuthReader {
  read(filePath: string): Promise<string | null>;
}

export interface CodexProviderDeps {
  httpClient: HttpClient;
  clock: Pick<Clock, "now">;
  authReader: CodexAuthReader;
  /** Injected instead of os.homedir() so the cascade is testable without touching the real OS. */
  homeDir: string;
  /** Injected instead of process.platform for the same reason. */
  platform: NodeJS.Platform;
  /** Injected instead of process.env.CODEX_HOME. */
  codexHomeEnv?: string;
}

/**
 * Resolves the Codex home directory: `CODEX_HOME` env var if set, else
 * `{homeDir}/.codex` using the path separator matching `platform`
 * (`%USERPROFILE%\.codex` on Windows, per the Codex Dual Auth Cascade spec).
 */
export function resolveCodexHome(params: { codexHomeEnv?: string; homeDir: string; platform: NodeJS.Platform }): string {
  if (params.codexHomeEnv && params.codexHomeEnv.length > 0) return params.codexHomeEnv;
  const join = params.platform === "win32" ? path.win32.join : path.posix.join;
  return join(params.homeDir, ".codex");
}

export interface CodexAuthTokens {
  accessToken: string;
  accountId?: string;
  idToken?: string;
}

/** Parses auth.json's `tokens` shape. Returns null on invalid JSON or a missing/invalid access_token. */
export function parseCodexAuthFile(raw: string): CodexAuthTokens | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const tokens = (data as Record<string, unknown>).tokens;
  if (typeof tokens !== "object" || tokens === null) return null;

  const accessToken = (tokens as Record<string, unknown>).access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;

  const accountId = (tokens as Record<string, unknown>).account_id;
  const idToken = (tokens as Record<string, unknown>).id_token;
  return {
    accessToken,
    accountId: typeof accountId === "string" ? accountId : undefined,
    idToken: typeof idToken === "string" ? idToken : undefined,
  };
}

function base64UrlDecode(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

/**
 * Decodes (without verifying) the `chatgpt_account_id` claim under the
 * `https://api.openai.com/auth` namespace from a JWT's payload segment.
 */
export function decodeJwtAccountId(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    const authClaims = payload["https://api.openai.com/auth"];
    if (typeof authClaims !== "object" || authClaims === null) return undefined;
    const claim = (authClaims as Record<string, unknown>).chatgpt_account_id;
    return typeof claim === "string" ? claim : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Account ID cascade: `auth.json`'s own `tokens.account_id` wins if present,
 * else it's decoded from the JWT `id_token`'s claim (design.md Adapters).
 */
export function resolveCodexAccountId(tokens: CodexAuthTokens): string | undefined {
  if (tokens.accountId) return tokens.accountId;
  if (tokens.idToken) return decodeJwtAccountId(tokens.idToken);
  return undefined;
}

interface CodexUsageWindow {
  used_percent?: number;
  reset_at?: number;
  reset_after_seconds?: number;
}

interface CodexUsageResponse {
  rate_limit?: {
    primary_window?: CodexUsageWindow;
    secondary_window?: CodexUsageWindow;
  };
  additional_rate_limits?: Array<{
    limit_name?: string;
    metered_feature?: string;
    rate_limit?: { primary_window?: CodexUsageWindow };
  }>;
}

/**
 * Resolves the ISO timestamp a window resets at. `reset_at` (absolute epoch
 * seconds) takes precedence over `reset_after_seconds` (relative offset from
 * now) when both are present — an absolute timestamp is more accurate once
 * the response has been in flight for any non-trivial time.
 */
function normalizeResetsAt(win: CodexUsageWindow, nowMs: number): string | null {
  if (typeof win.reset_at === "number") return new Date(win.reset_at * 1000).toISOString();
  if (typeof win.reset_after_seconds === "number") return new Date(nowMs + win.reset_after_seconds * 1000).toISOString();
  return null;
}

function toWindow(win: CodexUsageWindow | undefined, kind: string, label: string, nowMs: number): QuotaWindow | null {
  if (!win || typeof win.used_percent !== "number") return null;
  return { kind, label, utilization: win.used_percent, resetsAt: normalizeResetsAt(win, nowMs) };
}

/**
 * Normalizes a `wham/usage` response body into `QuotaWindow[]`
 * (provider-adapters spec: QuotaProvider Contract). `primary_window` /
 * `secondary_window` map to `WINDOW_KIND.FiveHour` / `SevenDay`;
 * `additional_rate_limits` entries become their own windows keyed by
 * `limit_name`/`metered_feature`. Throws a `provider-broken` TypedError on
 * any unrecognizable shape (missing `rate_limit`, non-object body, or no
 * usable window at all).
 */
export function normalizeCodexUsage(body: unknown, nowMs: number): QuotaWindow[] {
  if (typeof body !== "object" || body === null) {
    throw new TypedError("provider-broken", "Codex usage response was not a JSON object");
  }
  const rateLimit = (body as CodexUsageResponse).rate_limit;
  if (typeof rateLimit !== "object" || rateLimit === null) {
    throw new TypedError("provider-broken", "Codex usage response is missing rate_limit");
  }

  const windows: QuotaWindow[] = [];
  const primary = toWindow(rateLimit.primary_window, WINDOW_KIND.FiveHour, "Last 5 hours", nowMs);
  if (primary) windows.push(primary);
  const secondary = toWindow(rateLimit.secondary_window, WINDOW_KIND.SevenDay, "Last 7 days", nowMs);
  if (secondary) windows.push(secondary);

  const additional = (body as CodexUsageResponse).additional_rate_limits;
  if (Array.isArray(additional)) {
    for (const extra of additional) {
      // Skip entries missing both identification fields — retaining an unlabelled
      // window would produce ambiguous UI output and hide real data quality issues.
      const label = extra.limit_name ?? extra.metered_feature;
      if (!label) continue;
      const extraWindow = toWindow(extra.rate_limit?.primary_window, label, label, nowMs);
      if (extraWindow) windows.push(extraWindow);
    }
  }

  if (windows.length === 0) {
    throw new TypedError("provider-broken", "Codex usage response contained no usable window");
  }
  return windows;
}

/**
 * Classifies a non-2xx `wham/usage` status per the Codex 401 Recovery spec:
 * 401/403 -> auth-expired (reconnect prompt); everything else (429, 5xx,
 * etc.) -> provider-broken (error card + scheduler backoff, no reconnect).
 */
export function classifyCodexHttpError(status: number): TypedError {
  if (status === 401 || status === 403) {
    return new TypedError("auth-expired", `Codex usage request failed with status ${status}`, status);
  }
  return new TypedError("provider-broken", `Codex usage request failed with status ${status}`, status);
}

interface CodexInstanceState {
  accessToken: string;
  accountId?: string;
  authStatus: AuthStatus;
}

export class CodexProvider implements QuotaProvider {
  readonly providerId = "codex" as const;
  private readonly instances = new Map<string, CodexInstanceState>();

  constructor(private readonly deps: CodexProviderDeps) {}

  /**
   * Zero-config CLI path only: reads `auth.json` via the injected reader.
   * If it's absent or malformed, the instance is marked "unconfigured" --
   * the web-login fallback (opening a BrowserWindow) is the shell's
   * responsibility (Phase 4), not this pure adapter's.
   */
  async configure(instance: ProviderInstance): Promise<void> {
    const home = resolveCodexHome({
      codexHomeEnv: this.deps.codexHomeEnv,
      homeDir: this.deps.homeDir,
      platform: this.deps.platform,
    });
    const join = this.deps.platform === "win32" ? path.win32.join : path.posix.join;
    const authPath = join(home, "auth.json");

    const raw = await this.deps.authReader.read(authPath);
    let tokens = raw === null ? null : parseCodexAuthFile(raw);
    // Re-read once on parse failure: the file may have been partially written
    // during a concurrent auth refresh (transient write-in-progress race).
    if (raw !== null && tokens === null) {
      const rawRetry = await this.deps.authReader.read(authPath);
      tokens = rawRetry === null ? null : parseCodexAuthFile(rawRetry);
    }
    if (!tokens) {
      this.instances.set(instance.instanceId, { accessToken: "", authStatus: "unconfigured" });
      return;
    }

    this.instances.set(instance.instanceId, {
      accessToken: tokens.accessToken,
      accountId: resolveCodexAccountId(tokens),
      authStatus: "healthy",
    });
  }

  async fetchQuota(instance: ProviderInstance): Promise<QuotaWindow[]> {
    const state = this.instances.get(instance.instanceId);
    if (!state || state.authStatus === "unconfigured") {
      throw new TypedError("auth-expired", "Codex instance is not configured");
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${state.accessToken}`,
      Accept: "application/json",
      [ORIGINATOR_HEADER]: CODEX_ORIGINATOR,
    };
    if (state.accountId) headers["ChatGPT-Account-Id"] = state.accountId;

    let response;
    try {
      response = await this.deps.httpClient.get(CODEX_USAGE_URL, { headers });
    } catch {
      throw new TypedError("network", "Failed to reach the Codex usage endpoint");
    }

    if (response.status < 200 || response.status >= 300) {
      const error = classifyCodexHttpError(response.status);
      if (error.kind === "auth-expired") state.authStatus = "auth-expired";
      throw error;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TypedError("provider-broken", "Codex usage response body was not valid JSON");
    }

    const windows = normalizeCodexUsage(body, this.deps.clock.now());
    state.authStatus = "healthy";
    return windows;
  }

  async authStatus(instance: ProviderInstance): Promise<AuthStatus> {
    return this.instances.get(instance.instanceId)?.authStatus ?? "unconfigured";
  }
}

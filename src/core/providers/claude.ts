// Claude QuotaProvider adapter (design.md "Adapters" / D4 / provider-adapters
// spec: Claude Org-ID Discovery, Claude Cloudflare-Cleared Fetch). This file
// owns fetch/parse/error-classification logic ONLY: the actual hidden/visible
// BrowserWindow manipulation and cookie reading are injected through
// ClaudeWindowIO (design.md D4 -- "escalation DECISION in pure core, only
// window manipulation in shell"). The escalation decision itself delegates
// to CfEscalation (src/core/cf.ts), one instance per ProviderInstance so two
// instances' Cloudflare states never interfere with each other.
import { CfEscalation, type FetchMode } from "../cf";
import { TypedError, WINDOW_KIND, type AuthStatus, type ProviderInstance, type QuotaProvider, type QuotaWindow } from "../../shared/domain";

export interface ClaudeFetchResult {
  /** True when the response was a Cloudflare challenge page instead of usage JSON. */
  challengeDetected: boolean;
  /** HTTP status of the underlying request. Absent when challengeDetected is true. */
  status?: number;
  /** Parsed JSON body. Present only on a non-challenged 2xx response. */
  body?: unknown;
}

export interface ClaudeWindowIO {
  /**
   * Performs the authenticated fetch to claude.ai's usage endpoint for
   * `orgId` using the requested fetch mode. Never throws for a logical
   * failure (challenge, non-2xx status) -- those are reported via the
   * returned result. May reject for a genuine transport-level failure.
   */
  fetchUsage(orgId: string, mode: FetchMode): Promise<ClaudeFetchResult>;
  /** Reads the `lastActiveOrg` cookie value from this instance's login session, if present. */
  readLastActiveOrgCookie(): Promise<string | null>;
}

export interface ClaudeProviderDeps {
  windowIO: ClaudeWindowIO;
}

interface ClaudeUsageWindow {
  utilization?: number;
  resets_at?: string;
}

interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindow;
  seven_day?: ClaudeUsageWindow;
}

function toWindow(win: ClaudeUsageWindow | undefined, kind: string, label: string): QuotaWindow | null {
  if (!win || typeof win.utilization !== "number") return null;
  return { kind, label, utilization: win.utilization, resetsAt: win.resets_at ?? null };
}

/**
 * Normalizes a Claude `organizations/{orgId}/usage` response body into
 * `QuotaWindow[]` (provider-adapters spec: QuotaProvider Contract).
 * `five_hour`/`seven_day` map 1:1 to `WINDOW_KIND.FiveHour`/`SevenDay`;
 * `utilization` is already 0-100 and `resets_at` is already an ISO string,
 * so neither needs conversion (unlike Codex's epoch/relative cascade).
 * Throws a `provider-broken` TypedError when neither window is present.
 */
export function normalizeClaudeUsage(body: unknown): QuotaWindow[] {
  if (typeof body !== "object" || body === null) {
    throw new TypedError("provider-broken", "Claude usage response was not a JSON object");
  }
  const data = body as ClaudeUsageResponse;
  const windows: QuotaWindow[] = [];
  const fiveHour = toWindow(data.five_hour, WINDOW_KIND.FiveHour, "Last 5 hours");
  if (fiveHour) windows.push(fiveHour);
  const sevenDay = toWindow(data.seven_day, WINDOW_KIND.SevenDay, "Last 7 days");
  if (sevenDay) windows.push(sevenDay);

  if (windows.length === 0) {
    throw new TypedError("provider-broken", "Claude usage response contained no usable window");
  }
  return windows;
}

/**
 * Classifies a non-challenged, non-2xx usage response status: 401/403 ->
 * auth-expired (matches the shared taxonomy used by the Codex adapter and
 * polling-scheduler spec); everything else -> provider-broken.
 */
export function classifyClaudeHttpError(status: number): TypedError {
  if (status === 401 || status === 403) {
    return new TypedError("auth-expired", `Claude usage request failed with status ${status}`, status);
  }
  return new TypedError("provider-broken", `Claude usage request failed with status ${status}`, status);
}

interface ClaudeInstanceState {
  orgId: string | null;
  authStatus: AuthStatus;
  /** Fetch mode to use for this instance's NEXT attempt (CfEscalation's decision from the last one). */
  nextMode: FetchMode;
  cf: CfEscalation;
}

export class ClaudeProvider implements QuotaProvider {
  readonly providerId = "claude" as const;
  private readonly instances = new Map<string, ClaudeInstanceState>();

  constructor(private readonly deps: ClaudeProviderDeps) {}

  /**
   * Org-ID cascade (Claude Org-ID Discovery spec): (1) `lastActiveOrg`
   * cookie from the login session; (2) `instance.orgId` if the caller
   * configured one manually in settings; (3) terminal unconfigured -- no
   * fetch is attempted until one of the first two yields a usable org ID.
   */
  async configure(instance: ProviderInstance & { orgId?: string }): Promise<void> {
    const cookieOrgId = await this.deps.windowIO.readLastActiveOrgCookie();
    const orgId = cookieOrgId ?? instance.orgId ?? null;

    this.instances.set(instance.instanceId, {
      orgId,
      authStatus: orgId ? "healthy" : "unconfigured",
      nextMode: "hidden",
      cf: new CfEscalation(),
    });
  }

  async fetchQuota(instance: ProviderInstance): Promise<QuotaWindow[]> {
    const state = this.instances.get(instance.instanceId);
    if (!state || !state.orgId) {
      throw new TypedError("auth-expired", "Claude instance is not configured");
    }

    let result: ClaudeFetchResult;
    try {
      result = await this.deps.windowIO.fetchUsage(state.orgId, state.nextMode);
    } catch {
      throw new TypedError("network", "Failed to reach the Claude usage endpoint");
    }

    const decision = state.cf.recordFetch(result.challengeDetected);
    state.nextMode = decision.mode;

    if (result.challengeDetected) {
      if (decision.unreachable) {
        throw new TypedError("provider-broken", "Claude usage endpoint is unreachable behind a persistent Cloudflare challenge");
      }
      throw new TypedError("network", "Claude usage fetch was blocked by a Cloudflare challenge; retrying with an escalated fetch mode");
    }

    if (result.status === undefined || result.status < 200 || result.status >= 300) {
      const error = result.status === undefined
        ? new TypedError("provider-broken", "Claude usage fetch returned no response")
        : classifyClaudeHttpError(result.status);
      if (error.kind === "auth-expired") state.authStatus = "auth-expired";
      throw error;
    }

    const windows = normalizeClaudeUsage(result.body);
    state.authStatus = "healthy";
    return windows;
  }

  async authStatus(instance: ProviderInstance): Promise<AuthStatus> {
    return this.instances.get(instance.instanceId)?.authStatus ?? "unconfigured";
  }
}

// HttpClient port (design.md D1 / "Ports (injected): HttpClient{get}"). The
// Codex and Claude adapters depend on this interface only, never on a
// concrete fetch implementation -- the real implementation (global `fetch`)
// lives in src/main/adapters/electron/httpClient.ts. Pure type declarations,
// no logic to unit-test here; covered indirectly via adapter tests using a
// fake HttpClient.
export interface HttpResponse {
  /** HTTP status code, e.g. 200, 401, 503. */
  status: number;
  /** Parses the response body as JSON. May reject if the body isn't valid JSON. */
  json(): Promise<unknown>;
}

export interface HttpRequestInit {
  headers?: Record<string, string>;
  /**
   * Request timeout in milliseconds. Defaults to `DEFAULT_HTTP_TIMEOUT_MS`
   * when omitted. Real implementations (FetchHttpClient) MUST abort the
   * request once this elapses and let the abort propagate as a rejection --
   * a hung request must never leave the caller (and the Scheduler's
   * per-instance in-flight guard) waiting forever, since that would brick
   * the instance until the app is restarted.
   */
  timeoutMs?: number;
}

/** Default request timeout (provider-adapters spec: fetches must not hang indefinitely). */
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export interface HttpClient {
  get(url: string, init?: HttpRequestInit): Promise<HttpResponse>;
}

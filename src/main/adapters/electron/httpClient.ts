// Real HttpClient port implementation (design.md D1), using the global
// `fetch` available in Node 18+/Electron's main process -- no extra HTTP
// library dependency. Thin shell with no branching logic: the Codex/Claude
// adapters' parsing/normalization/error-classification logic is covered by
// unit tests using the FakeHttpClient test double
// (test/helpers/fakeHttpClient.ts).
//
// Timeout lifecycle (three paths):
//
//  1. fetch() REJECTS (DNS failure, pre-headers abort, etc.)
//     → timer cleared in the catch block, rejection re-thrown as-is.
//
//  2. Non-2xx response (or any response where the caller will not call json())
//     → timer cleared immediately after fetch() resolves, before returning.
//     Providers inspect .status only for non-2xx; they never call json(), so
//     the timer must be gone by the time get() returns.
//
//  3. 2xx response — caller WILL call json()
//     → timer stays alive through body consumption so a stalled body read
//     triggers the abort and rejects as TypedError("network"). Timer is
//     cleared in json()'s finally block regardless of success or failure.
import { DEFAULT_HTTP_TIMEOUT_MS, type HttpClient, type HttpRequestInit, type HttpResponse } from "../../../core/providers/httpClient";
import { TypedError } from "../../../shared/domain";

function clearTimer(timer: ReturnType<typeof setTimeout> | undefined): undefined {
  if (timer !== undefined) clearTimeout(timer);
  return undefined;
}

export class FetchHttpClient implements HttpClient {
  async get(url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    const timeoutMs = init?.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: init?.headers,
        signal: controller.signal,
      });
    } catch (err) {
      // Path 1: fetch() itself rejected — clean up timer immediately.
      timer = clearTimer(timer);
      throw err;
    }

    // Path 2: non-2xx (or any response the caller will not consume via json()).
    // Clear the timer now. The returned HttpResponse's json() will still work
    // (the body hasn't been read yet), but its finally block becomes a no-op.
    if (response.status < 200 || response.status >= 300) {
      timer = clearTimer(timer);
    }

    return {
      status: response.status,
      // Path 3 (2xx): timer kept alive through json() for stall protection.
      json: async () => {
        try {
          return await response.json();
        } catch (err) {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
            throw new TypedError("network", "Response body read timed out (AbortError)");
          }
          throw err;
        } finally {
          timer = clearTimer(timer);
        }
      },
    };
  }
}

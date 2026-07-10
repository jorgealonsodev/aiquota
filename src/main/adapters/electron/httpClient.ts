// Real HttpClient port implementation (design.md D1), using the global
// `fetch` available in Node 18+/Electron's main process -- no extra HTTP
// library dependency. Thin shell with no branching logic: the Codex/Claude
// adapters' parsing/normalization/error-classification logic is covered by
// unit tests using the FakeHttpClient test double
// (test/helpers/fakeHttpClient.ts).
//
// Timeout lifecycle: the AbortController timer is intentionally kept active
// through response.json() body parsing. Clearing the timer only after
// headers resolve (the previous design) allowed a hung body read to stall
// indefinitely and deadlock the provider/scheduler. The timer is now cleared
// only after json() either resolves or rejects; on abort the rejection is
// re-thrown as a TypedError("network") so callers receive a typed failure.
import { DEFAULT_HTTP_TIMEOUT_MS, type HttpClient, type HttpRequestInit, type HttpResponse } from "../../../core/providers/httpClient";
import { TypedError } from "../../../shared/domain";

export class FetchHttpClient implements HttpClient {
  async get(url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    const timeoutMs = init?.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const controller = new AbortController();
    // Timer is kept alive until json() completes — NOT cleared after headers.
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "GET",
      headers: init?.headers,
      signal: controller.signal,
    });

    return {
      status: response.status,
      json: async () => {
        try {
          return await response.json();
        } catch (err) {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
            throw new TypedError("network", "Response body read timed out (AbortError)");
          }
          throw err;
        } finally {
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
        }
      },
    };
  }
}

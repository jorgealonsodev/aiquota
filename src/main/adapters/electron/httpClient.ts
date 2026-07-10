// Real HttpClient port implementation (design.md D1), using the global
// `fetch` available in Node 18+/Electron's main process -- no extra HTTP
// library dependency. Thin shell with no branching logic: the Codex/Claude
// adapters' parsing/normalization/error-classification logic is covered by
// unit tests using the FakeHttpClient test double
// (test/helpers/fakeHttpClient.ts).
import { DEFAULT_HTTP_TIMEOUT_MS, type HttpClient, type HttpRequestInit, type HttpResponse } from "../../../core/providers/httpClient";

export class FetchHttpClient implements HttpClient {
  async get(url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    const timeoutMs = init?.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: init?.headers,
        signal: controller.signal,
      });
      return {
        status: response.status,
        json: () => response.json(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

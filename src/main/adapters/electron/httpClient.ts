// Real HttpClient port implementation (design.md D1), using the global
// `fetch` available in Node 18+/Electron's main process -- no extra HTTP
// library dependency. Thin shell with no branching logic: the Codex/Claude
// adapters' parsing/normalization/error-classification logic is covered by
// unit tests using the FakeHttpClient test double
// (test/helpers/fakeHttpClient.ts).
import type { HttpClient, HttpRequestInit, HttpResponse } from "../../../core/providers/httpClient";

export class FetchHttpClient implements HttpClient {
  async get(url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    const response = await fetch(url, { method: "GET", headers: init?.headers });
    return {
      status: response.status,
      json: () => response.json(),
    };
  }
}

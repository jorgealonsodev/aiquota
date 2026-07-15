import type { HttpClient, HttpRequestInit, HttpResponse } from "../../src/core/providers/httpClient";

export interface RecordedRequest {
  url: string;
  init?: HttpRequestInit;
}

/**
 * Scripted HttpClient test double. Each call to get() consumes the next
 * queued response (or rejection) and records the request so tests can assert
 * on the exact URL/headers an adapter sent.
 */
export class FakeHttpClient implements HttpClient {
  readonly requests: RecordedRequest[] = [];
  private readonly queue: Array<{ status: number; body?: unknown; jsonError?: Error } | { reject: Error }> = [];

  queueJson(status: number, body: unknown): this {
    this.queue.push({ status, body });
    return this;
  }

  queueJsonParseFailure(status: number): this {
    this.queue.push({ status, jsonError: new Error("invalid JSON") });
    return this;
  }

  queueRejection(error: Error): this {
    this.queue.push({ reject: error });
    return this;
  }

  async get(url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    this.requests.push({ url, init });
    const next = this.queue.shift();
    if (!next) throw new Error("FakeHttpClient: no queued response for get()");
    if ("reject" in next) throw next.reject;
    return {
      status: next.status,
      json: async () => {
        if (next.jsonError) throw next.jsonError;
        return next.body;
      },
    };
  }
}

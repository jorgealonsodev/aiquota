import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchHttpClient } from "../../../../src/main/adapters/electron/httpClient";
import { DEFAULT_HTTP_TIMEOUT_MS } from "../../../../src/core/providers/httpClient";

describe("FetchHttpClient (design.md D1 real HttpClient port implementation)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues a GET request with the given headers, an abort signal, and exposes status + json()", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new FetchHttpClient();
    const response = await client.get("https://example.com/usage", { headers: { Authorization: "Bearer token" } });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/usage",
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer token" }, signal: expect.any(AbortSignal) }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("passes undefined headers through when no init is given, rather than fabricating a default object", async () => {
    const fetchSpy = vi.fn(async () => ({ status: 404, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new FetchHttpClient();
    await client.get("https://example.com/missing");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/missing",
      expect.objectContaining({ method: "GET", headers: undefined }),
    );
  });

  describe("timeout (BLOCKER: a hung request must never wait forever)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("aborts the request once the requested timeoutMs elapses, and the rejection propagates", async () => {
      const fetchSpy = vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_, reject) => {
            options.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
          }),
      );
      vi.stubGlobal("fetch", fetchSpy);

      const client = new FetchHttpClient();
      const pending = client.get("https://example.com/usage", { timeoutMs: 5000 });
      const assertion = expect(pending).rejects.toThrow("aborted");

      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    });

    it("does not abort before timeoutMs has elapsed", async () => {
      const fetchSpy = vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            setTimeout(() => resolve({ status: 200, json: async () => ({}) }), 1000);
          }),
      );
      vi.stubGlobal("fetch", fetchSpy);

      const client = new FetchHttpClient();
      const pending = client.get("https://example.com/usage", { timeoutMs: 5000 });

      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toMatchObject({ status: 200 });
    });

    it("uses DEFAULT_HTTP_TIMEOUT_MS when the caller doesn't specify one", async () => {
      const fetchSpy = vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_, reject) => {
            options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      vi.stubGlobal("fetch", fetchSpy);

      const client = new FetchHttpClient();
      const pending = client.get("https://example.com/usage");
      const assertion = expect(pending).rejects.toThrow();

      await vi.advanceTimersByTimeAsync(DEFAULT_HTTP_TIMEOUT_MS);
      await assertion;
    });

    it("REGRESSION: rejects with a network TypedError when headers resolve but json() never settles (body stall deadlock)", async () => {
      // fetch() resolves immediately (headers received) but response.json() hangs forever.
      // The timeout must still fire and the call to response.json() must reject.
      const fetchSpy = vi.fn(async (_url: string, options: RequestInit) => ({
        status: 200,
        // json() returns a promise that never resolves unless the signal fires
        json: () =>
          new Promise<unknown>((_resolve, reject) => {
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted", "AbortError")),
            );
          }),
      }));
      vi.stubGlobal("fetch", fetchSpy);

      const client = new FetchHttpClient();
      const response = await client.get("https://example.com/usage", { timeoutMs: 3000 });
      const jsonPending = response.json();
      const assertion = expect(jsonPending).rejects.toMatchObject({ kind: "network" });

      await vi.advanceTimersByTimeAsync(3000);
      await assertion;
    });

    it("REGRESSION: no timer leak — timer is cleared after a successful json() read", async () => {
      // A stall-safe implementation must also clean up the timer on normal completion.
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const fetchSpy = vi.fn(async () => ({
        status: 200,
        json: async () => ({ result: "ok" }),
      }));
      vi.stubGlobal("fetch", fetchSpy);

      const client = new FetchHttpClient();
      const response = await client.get("https://example.com/usage", { timeoutMs: 5000 });
      await response.json();

      // clearTimeout must have been called at least once (timer cleanup)
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });
});

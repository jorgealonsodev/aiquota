import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchHttpClient } from "../../../../src/main/adapters/electron/httpClient";

describe("FetchHttpClient (design.md D1 real HttpClient port implementation)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues a GET request with the given headers and exposes status + json()", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new FetchHttpClient();
    const response = await client.get("https://example.com/usage", { headers: { Authorization: "Bearer token" } });

    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/usage", { method: "GET", headers: { Authorization: "Bearer token" } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("passes undefined headers through when no init is given, rather than fabricating a default object", async () => {
    const fetchSpy = vi.fn(async () => ({ status: 404, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new FetchHttpClient();
    await client.get("https://example.com/missing");

    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/missing", { method: "GET", headers: undefined });
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../../src/renderer/App";
import type { AppStateSnapshot } from "../../src/shared/ipc";
import type { ElectronAPI } from "../../src/preload/index";

function fakeApi(initial: AppStateSnapshot, onSubscribe?: (callback: (state: AppStateSnapshot) => void) => void): ElectronAPI {
  return {
    refresh: vi.fn(),
    getState: vi.fn().mockResolvedValue(initial),
    openSettings: vi.fn(),
    addAccount: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    onStateUpdate: vi.fn((callback: (state: AppStateSnapshot) => void) => {
      onSubscribe?.(callback);
      return vi.fn();
    }),
  } as unknown as ElectronAPI;
}

const initialState: AppStateSnapshot = {
  color: "amber",
  tooltip: "Codex 75%",
  instances: [
    {
      instanceId: "codex-1",
      label: "Codex",
      enabled: true,
      status: "healthy",
      windows: [{ kind: "five_hour", label: "Last 5 hours", utilization: 75, resetsAt: null }],
    },
  ],
};

describe("App renderer (quota-popup spec)", () => {
  it("renders a card for each instance in the snapshot", () => {
    const api = fakeApi(initialState);

    const html = renderToStaticMarkup(<App api={api} initialState={initialState} />);

    expect(html).toContain("Codex");
    expect(html).toContain("75%");
  });

  it("renders an empty-state message when no instances exist", () => {
    const api = fakeApi({ color: "gray", tooltip: "", instances: [] });

    const html = renderToStaticMarkup(<App api={api} initialState={{ color: "gray", tooltip: "", instances: [] }} />);

    expect(html).toContain("No accounts");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createElectronAPI, type ElectronAPI } from "../../src/preload/index";
import type { IpcRenderer } from "electron";
import type { AppStateSnapshot } from "../../src/shared/ipc";
import type { Settings } from "../../src/shared/domain";

function fakeIpcRenderer(): {
  ipcRenderer: IpcRenderer;
  sent: Array<{ channel: string; args: unknown[] }>;
  listeners: Map<string, Array<(...args: unknown[]) => void>>;
  responses: Map<string, unknown>;
} {
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const responses = new Map<string, unknown>();

  const ipcRenderer = {
    invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
      sent.push({ channel, args });
      return responses.get(channel);
    }),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(channel) ?? [];
      list.push(listener);
      listeners.set(channel, list);
    }),
    removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(channel) ?? [];
      listeners.set(
        channel,
        list.filter((l) => l !== listener),
      );
    }),
  } as unknown as IpcRenderer;

  return { ipcRenderer, sent, listeners, responses };
}

describe("preload typed IPC bridge (design D2/D3)", () => {
  it("invokes refresh with no argument", async () => {
    const { ipcRenderer, sent } = fakeIpcRenderer();
    const api = createElectronAPI(ipcRenderer);

    await api.refresh();

    expect(sent).toEqual([{ channel: "refresh", args: [] }]);
  });

  it("invokes refresh with an instanceId", async () => {
    const { ipcRenderer, sent } = fakeIpcRenderer();
    const api = createElectronAPI(ipcRenderer);

    await api.refresh("claude-1");

    expect(sent).toEqual([{ channel: "refresh", args: ["claude-1"] }]);
  });

  it("invokes getState and returns its result", async () => {
    const { ipcRenderer, sent, responses } = fakeIpcRenderer();
    const state: AppStateSnapshot = { color: "green", tooltip: "Codex 10%", instances: [] };
    responses.set("getState", state);
    const api = createElectronAPI(ipcRenderer);

    const result = await api.getState();

    expect(sent).toEqual([{ channel: "getState", args: [] }]);
    expect(result).toBe(state);
  });

  it("invokes openSettings", async () => {
    const { ipcRenderer, sent } = fakeIpcRenderer();
    const api = createElectronAPI(ipcRenderer);

    await api.openSettings();

    expect(sent).toEqual([{ channel: "openSettings", args: [] }]);
  });

  it("invokes addAccount with providerId", async () => {
    const { ipcRenderer, sent } = fakeIpcRenderer();
    const api = createElectronAPI(ipcRenderer);

    await api.addAccount("claude");

    expect(sent).toEqual([{ channel: "addAccount", args: ["claude"] }]);
  });

  it("invokes getSettings and returns its result", async () => {
    const { ipcRenderer, sent, responses } = fakeIpcRenderer();
    const settings: Settings = { instances: [], pollIntervalMinutes: 5, thresholds: [80, 95] };
    responses.set("getSettings", settings);
    const api = createElectronAPI(ipcRenderer);

    const result = await api.getSettings();

    expect(sent).toEqual([{ channel: "getSettings", args: [] }]);
    expect(result).toBe(settings);
  });

  it("invokes updateSettings with settings object", async () => {
    const { ipcRenderer, sent } = fakeIpcRenderer();
    const settings: Settings = { instances: [], pollIntervalMinutes: 10, thresholds: [70] };
    const api = createElectronAPI(ipcRenderer);

    await api.updateSettings(settings);

    expect(sent).toEqual([{ channel: "updateSettings", args: [settings] }]);
  });

  it("subscribes to state:update and returns an unsubscribe function", () => {
    const { ipcRenderer, listeners } = fakeIpcRenderer();
    const api = createElectronAPI(ipcRenderer);

    const callback = vi.fn();
    const unsubscribe = api.onStateUpdate(callback);

    expect(ipcRenderer.on).toHaveBeenCalledWith("state:update", expect.any(Function));

    const state: AppStateSnapshot = { color: "red", tooltip: "Codex 95%", instances: [] };
    const handler = listeners.get("state:update")?.[0];
    expect(handler).toBeDefined();
    handler?.({}, state);

    expect(callback).toHaveBeenCalledWith(state);

    unsubscribe();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith("state:update", expect.any(Function));
  });

  it("exposes no node primitives on the API surface", () => {
    const { ipcRenderer } = fakeIpcRenderer();
    const api: ElectronAPI = createElectronAPI(ipcRenderer);

    const keys = Object.keys(api);
    expect(keys).toEqual(["refresh", "getState", "openSettings", "addAccount", "getSettings", "updateSettings", "onStateUpdate"]);
  });
});

import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/ipc";
import type { IpcInvokeMap, IpcPushMap } from "../../src/shared/ipc";
import { makeSettings } from "../helpers/fixtures";

describe("shared IPC channel map", () => {
  it("names the renderer-to-main invoke channels exactly as design D3 lists them", () => {
    expect(IPC_CHANNELS.refresh).toBe("refresh");
    expect(IPC_CHANNELS.getState).toBe("getState");
    expect(IPC_CHANNELS.openSettings).toBe("openSettings");
    expect(IPC_CHANNELS.addAccount).toBe("addAccount");
    expect(IPC_CHANNELS.getSettings).toBe("getSettings");
    expect(IPC_CHANNELS.updateSettings).toBe("updateSettings");
  });

  it("names the main-to-renderer push channel as state:update", () => {
    expect(IPC_CHANNELS.stateUpdate).toBe("state:update");
  });

  it("exposes exactly 7 channels, no more no less", () => {
    expect(Object.keys(IPC_CHANNELS)).toHaveLength(7);
  });

  it("types invoke handlers so they can be implemented against real signatures", () => {
    const handlers: IpcInvokeMap = {
      [IPC_CHANNELS.refresh]: async () => undefined,
      [IPC_CHANNELS.getState]: async () => ({ color: "green", instances: [] }),
      [IPC_CHANNELS.openSettings]: async () => undefined,
      [IPC_CHANNELS.addAccount]: async () => undefined,
      [IPC_CHANNELS.getSettings]: async () => makeSettings(),
      [IPC_CHANNELS.updateSettings]: async () => undefined,
    };

    expect(typeof handlers[IPC_CHANNELS.refresh]).toBe("function");
  });

  it("types the push handler for state updates", () => {
    let received: unknown;
    const pushHandlers: IpcPushMap = {
      [IPC_CHANNELS.stateUpdate]: (state) => {
        received = state;
      },
    };

    pushHandlers[IPC_CHANNELS.stateUpdate]({ color: "red", instances: [] });

    expect(received).toEqual({ color: "red", instances: [] });
  });
});

import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/ipc";
import type { AppStateSnapshot, IpcInvokeMap, IpcPushMap } from "../../src/shared/ipc";
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
      [IPC_CHANNELS.getState]: async () => ({
        color: "green",
        tooltip: "Codex 10%",
        instances: [
          {
            instanceId: "codex-1",
            label: "Codex",
            enabled: true,
            status: "healthy",
            windows: [],
          },
        ],
      }),
      [IPC_CHANNELS.openSettings]: async () => undefined,
      [IPC_CHANNELS.addAccount]: async () => undefined,
      [IPC_CHANNELS.getSettings]: async () => makeSettings(),
      [IPC_CHANNELS.updateSettings]: async () => undefined,
    };

    expect(typeof handlers[IPC_CHANNELS.refresh]).toBe("function");
  });

  it("narrows AppStateSnapshot instances to a typed view model", () => {
    const snapshot: AppStateSnapshot = {
      color: "green",
      tooltip: "",
      instances: [
        {
          instanceId: "claude-1",
          label: "Claude",
          enabled: true,
          status: "auth-expired",
          windows: [{ kind: "five_hour", label: "Last 5 hours", utilization: 75, resetsAt: null }],
        },
      ],
    };

    expect(snapshot.instances[0].instanceId).toBe("claude-1");
    expect(snapshot.instances[0].status).toBe("auth-expired");
    expect(snapshot.instances[0].windows[0].utilization).toBe(75);
  });

  it("types the push handler for state updates", () => {
    let received: unknown;
    const pushHandlers: IpcPushMap = {
      [IPC_CHANNELS.stateUpdate]: (state) => {
        received = state;
      },
    };

    pushHandlers[IPC_CHANNELS.stateUpdate]({ color: "red", tooltip: "Codex 95%", instances: [] });

    expect(received).toEqual({ color: "red", tooltip: "Codex 95%", instances: [] });
  });
});

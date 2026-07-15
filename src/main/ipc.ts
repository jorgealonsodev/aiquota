// IPC wiring (design D3). Registers typed invoke handlers and provides a
// helper for pushing `state:update` to renderer windows. This is shell code
// and is covered by manual QA, not unit tests.
import { ipcMain, type WebContents } from "electron";
import { IPC_CHANNELS, type AppStateSnapshot, type IpcInvokeMap, type IpcChannelName } from "../shared/ipc";

/**
 * Registers all renderer-to-main invoke handlers. The caller supplies the
 * concrete implementations so this file stays a thin wiring layer.
 */
export function createIpcHandlers(handlers: IpcInvokeMap): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    if (channel === IPC_CHANNELS.stateUpdate) continue;

    const handler = handlers[channel as keyof IpcInvokeMap];
    if (!handler) continue;

    ipcMain.handle(channel, (_event, ...args: unknown[]) => {
      // The IpcInvokeMap signatures are the source of truth; the `as never`
      // is safe because we know the channel/key correspondence at compile time.
      return (handler as (...params: unknown[]) => unknown)(...args);
    });
  }
}

/**
 * Sends a `state:update` push to the given renderer `WebContents`.
 */
export function pushStateTo(webContents: WebContents, state: AppStateSnapshot): void {
  webContents.send(IPC_CHANNELS.stateUpdate as IpcChannelName, state);
}

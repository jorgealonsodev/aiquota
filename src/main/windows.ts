// BrowserWindow management (quota-popup + app-settings specs). Popup,
// settings, Claude login, and hidden/visible fetch windows. Shell code;
// covered by manual QA.
import { BrowserWindow, screen, session, type Tray, type BrowserWindowConstructorOptions } from "electron";
import path from "node:path";
import type { ClaudeFetchResult, ClaudeWindowIO } from "../core/providers/claude";
import type { FetchMode } from "../core/cf";

const PRELOAD_SCRIPT_PATH = path.join(__dirname, "../preload/index.js");
const RENDERER_INDEX_PATH = path.join(__dirname, "../../dist/renderer/index.html");

function commonWebPreferences(): BrowserWindowConstructorOptions["webPreferences"] {
  return {
    preload: PRELOAD_SCRIPT_PATH,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function loadRenderer(win: BrowserWindow, query?: string): void {
  void win.loadFile(RENDERER_INDEX_PATH, { query: query ? Object.fromEntries(new URLSearchParams(query).entries()) : undefined });
}

export interface WindowManager {
  showPopup(anchor: Tray): void;
  hidePopup(): void;
  getPopupWindow(): BrowserWindow | null;
  showSettings(): void;
  closeSettings(): void;
  getSettingsWindow(): BrowserWindow | null;
  createClaudeLoginWindow(instanceId: string): BrowserWindow;
  createClaudeWindowIO(instanceId: string): ClaudeWindowIO;
}

/**
 * Creates the window manager. Holds weak references to the popup and settings
 * windows so they can be reused across tray/context-menu interactions.
 */
export function createWindowManager(): WindowManager {
  let popup: BrowserWindow | null = null;
  let settingsWindow: BrowserWindow | null = null;

  function ensurePopup(): BrowserWindow {
    if (popup && !popup.isDestroyed()) return popup;

    popup = new BrowserWindow({
      width: 340,
      height: 420,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: commonWebPreferences(),
    });

    popup.on("blur", () => {
      popup?.hide();
    });

    popup.on("closed", () => {
      popup = null;
    });

    loadRenderer(popup);
    return popup;
  }

  function createClaudeLoginWindow(instanceId: string): BrowserWindow {
    const win = new BrowserWindow({
      width: 800,
      height: 700,
      title: "Sign in to Claude",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: session.fromPartition(`persist:claude-${instanceId}`),
      },
    });

    void win.loadURL("https://claude.ai/login");
    return win;
  }

  function createClaudeWindowIO(instanceId: string): ClaudeWindowIO {
    const claudeSession = session.fromPartition(`persist:claude-${instanceId}`);

    return {
      async readLastActiveOrgCookie(): Promise<string | null> {
        const sessionKey = await claudeSession.cookies.get({ url: "https://claude.ai", name: "sessionKey" });
        if (sessionKey.length === 0) {
          // No active session; open the login window and wait for the user.
          const win = createClaudeLoginWindow(instanceId);
          await new Promise<void>((resolve) => {
            const checkCookie = async (): Promise<void> => {
              const cookies = await claudeSession.cookies.get({ url: "https://claude.ai", name: "sessionKey" });
              if (cookies.length > 0) {
                win.close();
                resolve();
                return;
              }
              setTimeout(checkCookie, 1000);
            };
            win.on("closed", resolve);
            void checkCookie();
          });
        }

        const lastActiveOrg = await claudeSession.cookies.get({ url: "https://claude.ai", name: "lastActiveOrg" });
        return lastActiveOrg[0]?.value ?? null;
      },

      async fetchUsage(orgId: string, mode: FetchMode): Promise<ClaudeFetchResult> {
        const isVisible = mode === "visible";
        const win = new BrowserWindow({
          width: isVisible ? 800 : 1,
          height: isVisible ? 700 : 1,
          show: isVisible,
          frame: false,
          skipTaskbar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            session: claudeSession,
          },
        });

        try {
          const url = `https://claude.ai/api/organizations/${orgId}/usage`;
          const result = (await win.webContents.executeJavaScript(
            `
            (async () => {
              try {
                const res = await fetch(${JSON.stringify(url)}, {
                  credentials: "include",
                  headers: { "Accept": "application/json" }
                });
                const text = await res.text();
                if (res.status === 403 && text.toLowerCase().includes("cloudflare")) {
                  return { challengeDetected: true };
                }
                let body;
                try { body = JSON.parse(text); } catch { }
                return { status: res.status, body, challengeDetected: false };
              } catch (err) {
                return { networkError: String(err) };
              }
            })()
            `,
            true,
          )) as { challengeDetected?: boolean; status?: number; body?: unknown; networkError?: string };

          if (result.networkError) {
            throw new Error(result.networkError);
          }

          if (result.challengeDetected) {
            return { challengeDetected: true };
          }

          return { challengeDetected: false, status: result.status, body: result.body };
        } finally {
          win.close();
        }
      },
    };
  }

  return {
    showPopup: (anchor: Tray) => {
      const win = ensurePopup();
      const bounds = anchor.getBounds();
      const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
      const { width, height } = win.getBounds();

      // Position centered horizontally above the tray icon, clamped to the display.
      let x = Math.round(bounds.x + bounds.width / 2 - width / 2);
      let y = Math.round(bounds.y - height);

      x = Math.max(display.workArea.x, Math.min(x, display.workArea.x + display.workArea.width - width));
      y = Math.max(display.workArea.y, Math.min(y, display.workArea.y + display.workArea.height - height));

      win.setPosition(x, y, false);
      win.show();
      win.focus();
    },

    hidePopup: () => {
      if (popup && !popup.isDestroyed()) {
        popup.hide();
      }
    },

    getPopupWindow: () => popup,

    showSettings: () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.show();
        settingsWindow.focus();
        return;
      }

      settingsWindow = new BrowserWindow({
        width: 520,
        height: 640,
        title: "AIQuota Settings",
        webPreferences: commonWebPreferences(),
      });

      settingsWindow.on("closed", () => {
        settingsWindow = null;
      });

      loadRenderer(settingsWindow, "settings=1");
    },

    closeSettings: () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.close();
      }
    },

    getSettingsWindow: () => settingsWindow,
    createClaudeLoginWindow,
    createClaudeWindowIO,
  };
}

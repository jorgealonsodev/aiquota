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

/**
 * Locks a window that carries the full-privilege preload bridge
 * (`commonWebPreferences()`) to only ever show the bundled renderer it was
 * created with. These windows never need to navigate elsewhere or open
 * child windows, so any attempt to do so (e.g. from a future bug or
 * injected content) is denied at the Electron level rather than trusted.
 */
function hardenPrivilegedWindow(win: BrowserWindow): void {
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

const CLAUDE_LOGIN_ALLOWED_ORIGIN = "https://claude.ai";

/**
 * Restricts the (preload-less) Claude login window to the claude.ai origin.
 * `createClaudeWindowIO`'s cookie-polling flow only ever needs
 * https://claude.ai/login and the pages it renders inline; there is no
 * OAuth-provider redirect in this flow, so any navigation elsewhere is
 * denied rather than trusted. Popups are denied too — the flow never opens
 * one.
 *
 * Both `will-navigate` (renderer/user-initiated navigation) and
 * `will-redirect` (an HTTP 3xx mid-navigation) are guarded identically:
 * this window holds a real, persistent Claude session cookie
 * (`session.fromPartition("persist:claude-...")`), so an uncaught
 * server-side redirect off-origin is the concrete risk being closed here,
 * not just a user clicking a link. A blocked attempt is logged so a denied
 * legitimate redirect (e.g. an unexpected CAPTCHA/OAuth step on the live
 * login page) is distinguishable from a silent network failure.
 */
function hardenClaudeLoginWindow(win: BrowserWindow): void {
  const guardOrigin = (event: Electron.Event, url: string): void => {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      event.preventDefault();
      console.error(`[main] Claude login window blocked unparseable navigation: ${url}`);
      return;
    }
    if (origin !== CLAUDE_LOGIN_ALLOWED_ORIGIN) {
      event.preventDefault();
      console.error(`[main] Claude login window blocked off-origin navigation to ${origin}`);
    }
  };
  win.webContents.on("will-navigate", guardOrigin);
  win.webContents.on("will-redirect", guardOrigin);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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

    hardenPrivilegedWindow(popup);
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

    hardenClaudeLoginWindow(win);
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
            let cancelled = false;
            const checkCookie = async (): Promise<void> => {
              if (cancelled) return;
              const cookies = await claudeSession.cookies.get({ url: "https://claude.ai", name: "sessionKey" });
              if (cancelled) return;
              if (cookies.length > 0) {
                cancelled = true;
                win.close();
                resolve();
                return;
              }
              setTimeout(checkCookie, 1000);
            };
            win.on("closed", () => {
              cancelled = true;
              resolve();
            });
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

      hardenPrivilegedWindow(settingsWindow);
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

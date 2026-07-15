// Electron main process bootstrap (task 4.1). Wires the domain core
// (scheduler, store, notify, providers) to Electron adapters and the shell
// (tray, windows, IPC, notifications). Shell code; covered by manual QA.
import { app, dialog, session } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { NodeClock } from "./adapters/electron/clock";
import { FetchHttpClient } from "./adapters/electron/httpClient";
import { ElectronSecretStore } from "./adapters/electron/secretStore";
import { SettingsStore } from "./adapters/electron/settingsStore";
import { Scheduler } from "../core/scheduler";
import { StateStore } from "../core/store";
import { NotifyEngine } from "../core/notify";
import { CodexProvider } from "../core/providers/codex";
import { ClaudeProvider } from "../core/providers/claude";
import { aggregate } from "../core/aggregate";
import { createTray } from "./tray";
import { createWindowManager } from "./windows";
import { createIpcHandlers, pushStateTo } from "./ipc";
import { showThresholdNotification, showReconnectNotification } from "./notifications";
import { IPC_CHANNELS } from "../shared/ipc";
import type { AppStateSnapshot, IpcInvokeMap } from "../shared/ipc";
import type { Settings, SettingsInstance } from "../shared/domain";
import { isValidProviderId, TypedError } from "../shared/domain";
import { isValidSettingsShape, parseSettings } from "../core/settings";

interface BootstrapContext {
  secretStore: ElectronSecretStore;
  settingsStore: SettingsStore;
  scheduler: Scheduler;
  store: StateStore;
  notifier: NotifyEngine;
  settings: Settings;
  providers: { codex: CodexProvider; claude: ClaudeProvider };
  tray: ReturnType<typeof createTray>;
  windowManager: ReturnType<typeof createWindowManager>;
  pushState: () => AppStateSnapshot;
  clock: NodeClock;
}

function attachInstanceId(err: unknown, instanceId: string): TypedError {
  if (err instanceof TypedError) {
    return new TypedError(err.kind, `[${instanceId}] ${err.message}`, err.status);
  }
  return new TypedError("provider-broken", `[${instanceId}] ${(err as Error).message ?? String(err)}`);
}

function toViewModelSnapshot(store: StateStore): AppStateSnapshot {
  const trayState = aggregate(store.getAll());
  return {
    color: trayState.color,
    tooltip: trayState.tooltip,
    instances: store.getAll(),
  };
}

function buildHandlers(ctx: BootstrapContext): IpcInvokeMap {
  return {
    [IPC_CHANNELS.refresh]: async (instanceId?: string) => {
      if (instanceId) {
        await ctx.scheduler.refresh(instanceId);
      } else {
        await ctx.scheduler.refreshAll();
      }
    },

    [IPC_CHANNELS.getState]: async () => ctx.pushState(),

    [IPC_CHANNELS.openSettings]: async () => {
      ctx.windowManager.showSettings();
    },

    [IPC_CHANNELS.addAccount]: async (providerId) => {
      // Defensive runtime check at the IPC trust boundary: `providerId` is
      // typed as ProviderInstance["providerId"] at compile time, but a
      // malformed or malicious renderer call could still send anything.
      // Without this, `ctx.providers[providerId]` below would throw a raw
      // TypeError on lookup instead of a clear, actionable rejection.
      if (!isValidProviderId(providerId)) {
        throw new Error(`addAccount: invalid providerId "${String(providerId)}"`);
      }
      // MVP scope guard (provider-adapters spec): adapters are built to
      // support N instances per provider, but the MVP UI exposes only one
      // instance per provider. ClaudeProvider/CodexProvider are singletons
      // with one shared session/credential per provider type, so a second
      // instance of the same provider would silently share the first
      // instance's login/session rather than being independent.
      if (ctx.settings.instances.some((i) => i.providerId === providerId)) {
        throw new Error(
          `addAccount: an instance for provider "${providerId}" already exists (MVP supports one instance per provider)`,
        );
      }
      const id = `${providerId}-${Date.now()}`;
      const newInstance: SettingsInstance = {
        instanceId: id,
        providerId,
        label: providerId === "codex" ? "Codex" : "Claude",
        credentialsRef: id,
        enabled: false,
      };
      const nextSettings: Settings = {
        ...ctx.settings,
        instances: [...ctx.settings.instances, newInstance],
      };
      await ctx.settingsStore.save(nextSettings);
      applySettings(ctx, nextSettings);
      ctx.windowManager.showSettings();
    },

    [IPC_CHANNELS.getSettings]: async () => ctx.settings,

    [IPC_CHANNELS.updateSettings]: async (settings) => {
      // Defensive runtime check at the IPC trust boundary, mirroring
      // parseSettings()'s structural rules (src/core/settings.ts) but
      // rejecting instead of silently falling back to defaults — malformed
      // input here must not overwrite a user's valid settings.json.
      if (!isValidSettingsShape(settings) || !(settings.pollIntervalMinutes > 0)) {
        throw new Error("updateSettings: malformed Settings payload");
      }
      // Shape is valid but values may still be out of bounds (e.g. an
      // interval above MAX_INTERVAL_MINUTES, a threshold outside (0,100]).
      // Route through parseSettings() to apply the same clamp/sanitize/
      // allow-list rules used on file load, instead of persisting and
      // scheduling unclamped values straight from the renderer.
      const sanitized = parseSettings(settings);
      await ctx.settingsStore.save(sanitized);
      applySettings(ctx, sanitized);
    },
  };
}

function applySettings(ctx: BootstrapContext, next: Settings): void {
  const previous = ctx.settings;
  ctx.settings = next;

  const previousById = new Map(previous.instances.map((i) => [i.instanceId, i]));
  const nextById = new Map(next.instances.map((i) => [i.instanceId, i]));

  // Cancel removed instances.
  for (const id of previousById.keys()) {
    if (!nextById.has(id)) {
      const removed = previousById.get(id);
      ctx.scheduler.cancel(id);
      ctx.store.remove(id);
      ctx.notifier.remove(id);
      // Secure Credential Deletion (credential-store spec): removing an
      // instance must erase any stored secret and, for Claude instances,
      // the persisted login-session cookies. Today no provider writes
      // through secretStore.set() (Codex reads ~/.codex/auth.json
      // directly, Claude relies on session cookies), so this delete() call
      // is currently a forward-looking no-op; the session-partition clear
      // below is the operative cleanup for Claude instances.
      if (removed) {
        void ctx.secretStore.delete(removed.credentialsRef).catch((err) => {
          console.error(`[main] failed to delete credential for removed instance ${id}`, err);
        });
        if (removed.providerId === "claude") {
          void session
            .fromPartition(`persist:claude-${id}`)
            .clearStorageData()
            .catch((err) => {
              console.error(`[main] failed to clear session partition for removed instance ${id}`, err);
            });
        }
      }
    }
  }

  // Register new instances and reconfigure existing ones when relevant fields change.
  for (const instance of next.instances) {
    const existing = ctx.store.get(instance.instanceId);
    if (!existing) {
      ctx.store.register(instance.instanceId, {
        label: instance.label,
        enabled: instance.enabled,
        status: "unconfigured",
        windows: [],
      });
      void ctx.providers[instance.providerId]
        .configure(instance)
        .then(() => {
          // The user may have removed this instance while configure() was
          // still pending; if so, do not resurrect it into the scheduler —
          // there is no more UI control to stop it.
          if (!ctx.store.get(instance.instanceId)) {
            return;
          }
          if (instance.enabled) {
            scheduleInstance(ctx, instance);
          }
          ctx.pushState();
        })
        .catch((err) => {
          console.error(`[main] configure failed for instance ${instance.instanceId}`, err);
          const typed = attachInstanceId(err, instance.instanceId);
          ctx.store.update(instance.instanceId, { status: typed.kind === "auth-expired" ? "auth-expired" : "provider-broken" });
          ctx.pushState();
        });
      continue;
    }

    // Update label/enable state.
    ctx.store.update(instance.instanceId, { label: instance.label, enabled: instance.enabled });

    // If orgId changed for Claude, reconfigure.
    const prevInstance = previousById.get(instance.instanceId);
    if (instance.providerId === "claude" && prevInstance?.orgId !== instance.orgId) {
      ctx.scheduler.cancel(instance.instanceId);
      void ctx.providers.claude
        .configure(instance)
        .then(() => {
          // The user may have removed this instance while configure() was
          // still pending; if so, do not resurrect it into the scheduler —
          // there is no more UI control to stop it.
          if (!ctx.store.get(instance.instanceId)) {
            return;
          }
          if (instance.enabled) {
            scheduleInstance(ctx, instance);
          }
          ctx.pushState();
        })
        .catch((err) => {
          console.error(`[main] claude reconfigure failed for instance ${instance.instanceId}`, err);
          const typed = attachInstanceId(err, instance.instanceId);
          ctx.store.update(instance.instanceId, { status: typed.kind === "auth-expired" ? "auth-expired" : "provider-broken" });
          ctx.pushState();
        });
      continue;
    }

    // Reschedule if interval changed or enabled toggled on.
    if (instance.enabled && !prevInstance?.enabled) {
      // Transitioning from disabled to enabled: only new instances and
      // Claude org-ID changes (above) call configure() -- this instance was
      // never configured, so do it now before scheduling polls, mirroring
      // the new-instance path.
      void ctx.providers[instance.providerId]
        .configure(instance)
        .then(() => {
          // The user may have disabled/removed this instance while
          // configure() was still pending.
          const current = ctx.store.get(instance.instanceId);
          if (!current || !current.enabled) {
            return;
          }
          scheduleInstance(ctx, instance);
          ctx.pushState();
        })
        .catch((err) => {
          console.error(`[main] reconfigure failed for instance ${instance.instanceId}`, err);
          const typed = attachInstanceId(err, instance.instanceId);
          ctx.store.update(instance.instanceId, { status: typed.kind === "auth-expired" ? "auth-expired" : "provider-broken" });
          ctx.pushState();
        });
    } else if (instance.enabled && previous.pollIntervalMinutes !== next.pollIntervalMinutes) {
      scheduleInstance(ctx, instance);
    } else if (!instance.enabled && prevInstance?.enabled) {
      ctx.scheduler.cancel(instance.instanceId);
    }
  }

  ctx.pushState();
}

function scheduleInstance(ctx: BootstrapContext, instance: SettingsInstance): void {
  ctx.scheduler.schedule(instance.instanceId, ctx.settings.pollIntervalMinutes, async () => {
    const provider = ctx.providers[instance.providerId];
    const fetchedAt = ctx.clock.now();
    try {
      const windows = await provider.fetchQuota(instance);
      ctx.store.update(instance.instanceId, {
        status: "healthy",
        windows,
        fetchedAt,
      });
      // Clear the auth-expired transition marker on recovery so a later
      // auth-expired failure re-notifies (see notify.ts's processAuthStatus
      // contract). The catch branch below is the only other caller; without
      // this, lastAuthStatus stays pinned to "auth-expired" forever.
      ctx.notifier.processAuthStatus(instance.instanceId, "healthy");
      for (const window of windows) {
        const events = ctx.notifier.processWindow(
          { instanceId: instance.instanceId, kind: window.kind, utilization: window.utilization, resetsAt: window.resetsAt },
          ctx.settings.thresholds,
        );
        for (const event of events) {
          showThresholdNotification(event);
        }
      }
    } catch (err) {
      console.error(`[main] poll failed for instance ${instance.instanceId}`, err);
      const typed = attachInstanceId(err, instance.instanceId);
      const status = typed.kind === "auth-expired" ? "auth-expired" : typed.kind === "network" ? "network" : "provider-broken";
      ctx.store.update(instance.instanceId, { status, fetchedAt });
      if (status === "auth-expired") {
        const events = ctx.notifier.processAuthStatus(instance.instanceId, "auth-expired");
        for (const event of events) {
          showReconnectNotification(event);
        }
      }
      throw typed;
    } finally {
      ctx.tray.update(aggregate(ctx.store.getAll()));
      ctx.pushState();
    }
  });
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const userDataDir = app.getPath("userData");
  const secretStore = new ElectronSecretStore(path.join(userDataDir, "credentials"));
  const settingsStore = new SettingsStore(userDataDir);
  const settings = await settingsStore.load();

  const clock = new NodeClock();
  const scheduler = new Scheduler(clock);
  const store = new StateStore();
  const notifier = new NotifyEngine(clock);

  const httpClient = new FetchHttpClient();
  const codexProvider = new CodexProvider({
    httpClient,
    clock,
    authReader: {
      read: async (filePath) => {
        try {
          return await fs.readFile(filePath, "utf8");
        } catch {
          return null;
        }
      },
    },
    homeDir: app.getPath("home"),
    platform: process.platform,
  });

  const windowManager = createWindowManager();
  const claudeProvider = new ClaudeProvider({
    windowIO: windowManager.createClaudeWindowIO("claude-default"),
  });

  const providers = { codex: codexProvider, claude: claudeProvider };

  for (const instance of settings.instances) {
    store.register(instance.instanceId, {
      label: instance.label,
      enabled: instance.enabled,
      status: "unconfigured",
      windows: [],
    });
  }

  const tray = createTray({
    getTrayState: () => aggregate(store.getAll()),
    onOpen: () => windowManager.showPopup(tray.tray),
    onRefresh: () => scheduler.refreshAll(),
    onOpenSettings: () => windowManager.showSettings(),
    onQuit: () => app.quit(),
  });

  function pushState(): AppStateSnapshot {
    const snapshot = toViewModelSnapshot(store);
    const popup = windowManager.getPopupWindow();
    if (popup && !popup.isDestroyed()) {
      pushStateTo(popup.webContents, snapshot);
    }
    const settingsWindow = windowManager.getSettingsWindow();
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      pushStateTo(settingsWindow.webContents, snapshot);
    }
    return snapshot;
  }

  const ctx: BootstrapContext = {
    secretStore,
    settingsStore,
    scheduler,
    store,
    notifier,
    settings,
    providers,
    tray,
    windowManager,
    pushState,
    clock,
  };

  createIpcHandlers(buildHandlers(ctx));

  for (const instance of settings.instances.filter((i) => i.enabled)) {
    try {
      await providers[instance.providerId].configure(instance);
    } catch (err) {
      console.error(`[main] initial configure failed for instance ${instance.instanceId}`, err);
      const typed = attachInstanceId(err, instance.instanceId);
      store.update(instance.instanceId, { status: typed.kind === "auth-expired" ? "auth-expired" : "provider-broken" });
      // configure() failed: skip authStatus(), which would misreport this
      // real failure as "unconfigured" and hide it from the UI.
      continue;
    }
    const authStatus = await providers[instance.providerId].authStatus(instance);
    store.update(instance.instanceId, { status: authStatus });
    if (authStatus === "healthy") {
      scheduleInstance(ctx, instance);
    }
  }

  tray.update(aggregate(store.getAll()));
  pushState();

  app.on("window-all-closed", () => {
    // Intentionally empty: keep the tray app running when all windows close.
    // We do not call app.quit() here; the tray icon remains active.
  });

  app.on("activate", () => {
    windowManager.showSettings();
  });
}

void bootstrap().catch((err) => {
  console.error("[main] bootstrap failed", err);
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  dialog.showErrorBox("AIQuota failed to start", message);
  app.quit();
});

// Electron main process bootstrap (task 4.1). Wires the domain core
// (scheduler, store, notify, providers) to Electron adapters and the shell
// (tray, windows, IPC, notifications). Shell code; covered by manual QA.
import { app } from "electron";
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
import { TypedError } from "../shared/domain";

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
      await ctx.settingsStore.save(settings);
      applySettings(ctx, settings);
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
      ctx.scheduler.cancel(id);
      ctx.store.remove(id);
      ctx.notifier.remove(id);
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
          if (instance.enabled) {
            scheduleInstance(ctx, instance);
          }
          ctx.pushState();
        })
        .catch((err) => {
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
      void ctx.providers.claude.configure(instance).then(() => {
        if (instance.enabled) {
          scheduleInstance(ctx, instance);
        }
        ctx.pushState();
      });
      continue;
    }

    // Reschedule if interval changed or enabled toggled on.
    if (instance.enabled && (!prevInstance?.enabled || previous.pollIntervalMinutes !== next.pollIntervalMinutes)) {
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
      const typed = attachInstanceId(err, instance.instanceId);
      const status = typed.kind === "auth-expired" ? "auth-expired" : typed.kind === "network" ? "network" : "provider-broken";
      ctx.store.update(instance.instanceId, { status, fetchedAt });
      if (status === "auth-expired") {
        const events = ctx.notifier.processAuthStatus(instance.instanceId, "auth-expired");
        for (const event of events) {
          showReconnectNotification(event);
        }
      }
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
    await providers[instance.providerId]
      .configure(instance)
      .catch((err) => {
        const typed = attachInstanceId(err, instance.instanceId);
        store.update(instance.instanceId, { status: typed.kind === "auth-expired" ? "auth-expired" : "provider-broken" });
      });
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

void bootstrap();

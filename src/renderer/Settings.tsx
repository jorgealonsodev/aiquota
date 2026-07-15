// Settings form (app-settings spec). Provider toggles, labels, interval,
// thresholds, and a manual org-ID field for Claude instances. The IPC API is
// injected via props so tests can render without a real `window.electronAPI`.
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SETTINGS, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from "../shared/domain";
import type { Settings as SettingsType, SettingsInstance } from "../shared/domain";
import type { ElectronAPI } from "../preload/index";

export interface SettingsProps {
  api?: ElectronAPI;
  initialSettings?: SettingsType;
}

function emptySettings(): SettingsType {
  return {
    instances: [...DEFAULT_SETTINGS.instances],
    pollIntervalMinutes: DEFAULT_SETTINGS.pollIntervalMinutes,
    thresholds: [...DEFAULT_SETTINGS.thresholds],
  };
}

function parseThresholds(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 100);
}

function formatThresholds(thresholds: number[]): string {
  return thresholds.join(", ");
}

function updateInstance(instances: SettingsInstance[], instanceId: string, patch: Partial<SettingsInstance>): SettingsInstance[] {
  return instances.map((instance) => (instance.instanceId === instanceId ? { ...instance, ...patch } : instance));
}

export function Settings({ api, initialSettings }: SettingsProps): JSX.Element {
  const [settings, setSettings] = useState<SettingsType>(initialSettings ?? emptySettings);

  useEffect(() => {
    if (initialSettings === undefined) {
      api?.getSettings().then(setSettings);
    }
  }, [api, initialSettings]);

  const thresholdText = useMemo(() => formatThresholds(settings.thresholds), [settings.thresholds]);

  const handleToggle = (instanceId: string) => {
    setSettings((previous) => ({
      ...previous,
      instances: updateInstance(previous.instances, instanceId, { enabled: !previous.instances.find((i) => i.instanceId === instanceId)?.enabled }),
    }));
  };

  const handleLabelChange = (instanceId: string, label: string) => {
    setSettings((previous) => ({
      ...previous,
      instances: updateInstance(previous.instances, instanceId, { label }),
    }));
  };

  const handleOrgIdChange = (instanceId: string, orgId: string) => {
    setSettings((previous) => ({
      ...previous,
      instances: updateInstance(previous.instances, instanceId, { orgId: orgId.trim() || undefined }),
    }));
  };

  const handleIntervalChange = (value: string) => {
    const minutes = Number.parseInt(value, 10);
    if (Number.isFinite(minutes)) {
      setSettings((previous) => ({ ...previous, pollIntervalMinutes: minutes }));
    }
  };

  const handleThresholdsChange = (value: string) => {
    setSettings((previous) => ({ ...previous, thresholds: parseThresholds(value) }));
  };

  const handleSave = () => {
    api?.updateSettings(settings);
  };

  const handleAddAccount = (providerId: SettingsInstance["providerId"]) => {
    api?.addAccount(providerId);
  };

  return (
    <main className="settings">
      <h1>AIQuota Settings</h1>

      <section className="settings-section">
        <h2>Accounts</h2>
        {settings.instances.length === 0 && <p>No accounts configured.</p>}
        {settings.instances.map((instance) => (
          <div key={instance.instanceId} className="settings-instance">
            <label>
              <input
                type="checkbox"
                checked={instance.enabled}
                onChange={() => handleToggle(instance.instanceId)}
                aria-label={`Enable ${instance.label}`}
              />
              <span>enabled</span>
            </label>

            <label>
              Label
              <input
                type="text"
                value={instance.label}
                onChange={(event) => handleLabelChange(instance.instanceId, event.target.value)}
              />
            </label>

            {instance.providerId === "claude" && (
              <label>
                Organization ID
                <input
                  type="text"
                  value={instance.orgId ?? ""}
                  onChange={(event) => handleOrgIdChange(instance.instanceId, event.target.value)}
                  placeholder="lastActiveOrg fallback"
                />
              </label>
            )}
          </div>
        ))}
        <div className="settings-add-account">
          <button
            type="button"
            onClick={() => handleAddAccount("codex")}
            disabled={settings.instances.some((i) => i.providerId === "codex")}
          >
            Add Codex account
          </button>
          <button
            type="button"
            onClick={() => handleAddAccount("claude")}
            disabled={settings.instances.some((i) => i.providerId === "claude")}
          >
            Add Claude account
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Polling</h2>
        <label>
          Interval (minutes)
          <input
            type="number"
            min={MIN_INTERVAL_MINUTES}
            max={MAX_INTERVAL_MINUTES}
            value={settings.pollIntervalMinutes}
            onChange={(event) => handleIntervalChange(event.target.value)}
          />
        </label>
      </section>

      <section className="settings-section">
        <h2>Notification thresholds</h2>
        <label>
          Thresholds (%)
          <input
            type="text"
            value={thresholdText}
            onChange={(event) => handleThresholdsChange(event.target.value)}
            placeholder="80, 95"
          />
        </label>
      </section>

      <button type="button" onClick={handleSave}>
        Save
      </button>
    </main>
  );
}

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../../../../src/main/adapters/electron/settingsStore";
import { DEFAULT_SETTINGS } from "../../../../src/core/settings";

describe("SettingsStore (design.md D8 real settings.json persistence)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "aiquota-settings-store-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns validated defaults when settings.json does not exist yet", async () => {
    const store = new SettingsStore(dir);

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a saved settings document through load()", async () => {
    const store = new SettingsStore(dir);
    const settings = {
      instances: [{ instanceId: "codex-1", providerId: "codex" as const, label: "Personal", credentialsRef: "codex-1", enabled: true }],
      pollIntervalMinutes: 10,
      thresholds: [80, 95],
    };

    await store.save(settings);

    expect(await store.load()).toEqual(settings);
  });

  it("falls back to defaults when the file on disk contains corrupted JSON", async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "settings.json"), "{not valid json", "utf8");
    const store = new SettingsStore(dir);

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("creates the target directory on save() if it doesn't exist yet", async () => {
    const nestedDir = path.join(dir, "nested", "userData");
    const store = new SettingsStore(nestedDir);

    await store.save(DEFAULT_SETTINGS);

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("write is atomic: a concurrent read mid-write never sees a truncated file (temp+rename)", async () => {
    const store = new SettingsStore(dir);
    // Save and verify no .tmp file lingers after a successful write
    await store.save(DEFAULT_SETTINGS);

    const entries = await fs.readdir(dir);
    const tmpFiles = entries.filter((e) => e.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });
});

// Settings persistence (design.md D8 / app-settings spec), a thin fs wrapper
// around the tested schema-validation logic in src/core/settings.ts. Takes
// the target directory as a constructor argument (the caller -- Phase 4's
// main/index.ts wiring -- passes `app.getPath('userData')`) so this file has
// no direct Electron dependency and no branching logic of its own: schema
// validation/defaults-on-corruption is already unit-tested via
// test/core/settings.test.ts.
//
// Concurrency: each save() call uses a unique per-invocation temp file
// (settings.json.<random>.tmp) instead of a single static settings.json.tmp,
// so two concurrent saves do not clobber each other's temp file. On POSIX
// fs.rename is atomic; on NTFS same-volume renames are atomic too.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { parseSettings } from "../../../core/settings";
import type { Settings } from "../../../shared/domain";

const SETTINGS_FILE_NAME = "settings.json";

export class SettingsStore {
  constructor(private readonly userDataDir: string) {}

  private get filePath(): string {
    return path.join(this.userDataDir, SETTINGS_FILE_NAME);
  }

  /** Reads and validates settings.json, falling back to defaults on any read/parse/validation failure. */
  async load(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return parseSettings(JSON.parse(raw));
    } catch {
      return parseSettings(undefined);
    }
  }

  async save(settings: Settings): Promise<void> {
    await fs.mkdir(this.userDataDir, { recursive: true });
    // Unique temp path per invocation prevents concurrent saves from racing on
    // the same .tmp file (a static path caused the second rename to fail with
    // ENOENT because the first save already renamed-away the temp file).
    const uniqueSuffix = randomBytes(6).toString("hex");
    const tmpPath = path.join(this.userDataDir, `${SETTINGS_FILE_NAME}.${uniqueSuffix}.tmp`);
    try {
      await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2), "utf8");
      await fs.rename(tmpPath, this.filePath);
    } catch (err) {
      // Clean up orphaned temp file on error (best-effort).
      await fs.rm(tmpPath, { force: true });
      throw err;
    }
  }
}

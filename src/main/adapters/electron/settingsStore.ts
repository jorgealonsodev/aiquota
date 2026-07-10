// Settings persistence (design.md D8 / app-settings spec), a thin fs wrapper
// around the tested schema-validation logic in src/core/settings.ts. Takes
// the target directory as a constructor argument (the caller -- Phase 4's
// main/index.ts wiring -- passes `app.getPath('userData')`) so this file has
// no direct Electron dependency and no branching logic of its own: schema
// validation/defaults-on-corruption is already unit-tested via
// test/core/settings.test.ts.
import { promises as fs } from "node:fs";
import path from "node:path";
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
    // Atomic write via temp file + rename: a concurrent read never sees a
    // partially-written settings.json (write-then-rename is atomic on POSIX
    // file systems and Windows NTFS when src/dst are on the same volume).
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2), "utf8");
    await fs.rename(tmpPath, this.filePath);
  }
}

// Credential store (design.md §7 / credential-store spec: Encrypted-at-Rest
// Storage Keyed by Instance, Secure Credential Deletion). `maskCookie` is a
// pure function and is unit-tested directly. `ElectronSecretStore` wraps
// Electron's `safeStorage` (OS-keychain-backed) plus one file per credential
// on disk -- it is thin Electron/fs glue with no branching logic of its own,
// so per design.md's Testing table ("SecretStore keying/encoding: Unit;
// real keychain = manual") it is exercised via manual QA, not a unit test.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SafeStorage } from "electron";

/**
 * Lazily imports Electron's `safeStorage`. Importing the `electron` package
 * eagerly (a top-level `import ... from "electron"`) runs its own module
 * resolution logic on load -- which downloads the Electron binary if it's
 * missing -- so this stays a dynamic import, resolved only when a
 * get/set/delete call actually happens (never during this file's own unit
 * tests, which only exercise the pure `maskCookie` export).
 */
async function loadSafeStorage(): Promise<SafeStorage> {
  const electron = await import("electron");
  return electron.safeStorage;
}

export interface SecretStore {
  get(credentialsRef: string): Promise<string | null>;
  set(credentialsRef: string, value: string): Promise<void>;
  delete(credentialsRef: string): Promise<void>;
}

/**
 * Masks a credential value for safe diagnostic/log output (credential-store
 * spec: No Plaintext Credentials in Logs). Keeps the first and last 4
 * characters as a debugging aid; fully masks anything too short to do that
 * safely.
 */
export function maskCookie(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * `safeStorage`-backed SecretStore, one encrypted file per `credentialsRef`
 * under `baseDir` (the caller passes e.g.
 * `path.join(app.getPath('userData'), 'credentials')`). Never writes
 * plaintext to disk: `safeStorage.encryptString` runs before every write.
 */
export class ElectronSecretStore implements SecretStore {
  constructor(private readonly baseDir: string) {}

  private pathFor(credentialsRef: string): string {
    return path.join(this.baseDir, `${credentialsRef}.enc`);
  }

  async get(credentialsRef: string): Promise<string | null> {
    try {
      const safeStorage = await loadSafeStorage();
      const encrypted = await fs.readFile(this.pathFor(credentialsRef));
      return safeStorage.decryptString(encrypted);
    } catch {
      return null;
    }
  }

  async set(credentialsRef: string, value: string): Promise<void> {
    const safeStorage = await loadSafeStorage();
    const encrypted = safeStorage.encryptString(value);
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(this.pathFor(credentialsRef), encrypted);
  }

  async delete(credentialsRef: string): Promise<void> {
    await fs.rm(this.pathFor(credentialsRef), { force: true });
  }
}

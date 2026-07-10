// Credential store (design.md §7 / credential-store spec: Encrypted-at-Rest
// Storage Keyed by Instance, Secure Credential Deletion). `maskCookie` is a
// pure function and is unit-tested directly. `ElectronSecretStore` wraps
// Electron's `safeStorage` (OS-keychain-backed) plus one file per credential
// on disk.
//
// Fail-closed policy: if `safeStorage.isEncryptionAvailable()` returns false
// the store MUST throw rather than silently writing or reading plaintext.
// Missing-file (ENOENT) is a normal "not set yet" case and returns null;
// keychain / decryption failures are propagated as TypedError("credential-broken").
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SafeStorage } from "electron";
import { TypedError } from "../../../shared/domain";

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
 *
 * Fail-closed: throws TypedError("credential-broken") if OS encryption is
 * unavailable or if decryption fails (e.g. keychain error), so callers are
 * never silently handed garbled or unencrypted credentials.
 */
export class ElectronSecretStore implements SecretStore {
  constructor(private readonly baseDir: string) {}

  /**
   * Safe filename rule: credentialsRef must consist solely of alphanumeric
   * characters, hyphens, and underscores. This covers all known
   * credentialsRef conventions (e.g. "codex-1", "claude-personal",
   * "openai_api") while preventing ../ traversal, absolute path injection,
   * and path-separator embedding (/ or \).
   */
  private assertSafeRef(credentialsRef: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(credentialsRef)) {
      throw new TypedError(
        "credential-broken",
        `Invalid credentialsRef "${credentialsRef}": only alphanumeric, hyphen, and underscore characters are allowed`,
      );
    }
  }

  private pathFor(credentialsRef: string): string {
    return path.join(this.baseDir, `${credentialsRef}.enc`);
  }

  private assertStorageBackend(safeStorage: SafeStorage): void {
    // Electron on Linux can report encryption available while using a
    // hardcoded plaintext password (basic_text backend). Fail closed.
    const backend = (safeStorage as unknown as Record<string, unknown>).getSelectedStorageBackend;
    if (typeof backend === "function" && backend.call(safeStorage) === "basic_text") {
      throw new TypedError("credential-broken", "Electron safeStorage is using the basic_text backend; refusing to persist or read credentials in plaintext");
    }
  }

  async get(credentialsRef: string): Promise<string | null> {
    this.assertSafeRef(credentialsRef);
    const safeStorage = await loadSafeStorage();
    this.assertStorageBackend(safeStorage);
    if (!safeStorage.isEncryptionAvailable()) {
      throw new TypedError("credential-broken", "OS-level encryption is not available; refusing to read credential to avoid plaintext exposure");
    }
    let encrypted: Buffer;
    try {
      encrypted = await fs.readFile(this.pathFor(credentialsRef));
    } catch (err) {
      // ENOENT means the credential simply hasn't been set yet — not an error.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new TypedError("credential-broken", `Failed to read credential file: ${(err as Error).message}`);
    }
    try {
      return safeStorage.decryptString(encrypted);
    } catch (err) {
      throw new TypedError("credential-broken", `Failed to decrypt credential: ${(err as Error).message}`);
    }
  }

  async set(credentialsRef: string, value: string): Promise<void> {
    this.assertSafeRef(credentialsRef);
    const safeStorage = await loadSafeStorage();
    this.assertStorageBackend(safeStorage);
    if (!safeStorage.isEncryptionAvailable()) {
      throw new TypedError("credential-broken", "OS-level encryption is not available; refusing to persist credential in plaintext");
    }
    const encrypted = safeStorage.encryptString(value);
    await fs.mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.pathFor(credentialsRef), encrypted, { mode: 0o600 });
  }

  async delete(credentialsRef: string): Promise<void> {
    this.assertSafeRef(credentialsRef);
    await fs.rm(this.pathFor(credentialsRef), { force: true });
  }
}


import { describe, expect, it, vi, type Mock } from "vitest";
import { maskCookie } from "../../../../src/main/adapters/electron/secretStore";

describe("maskCookie (credential-store spec, No Plaintext Credentials in Logs)", () => {
  it("keeps the first 4 and last 4 characters and masks the middle", () => {
    expect(maskCookie("sk-ant-sid01-abcdefghijklmnopqrstuvwxyz")).toBe("sk-a...wxyz");
  });

  it("fully masks values too short to safely reveal any substring", () => {
    expect(maskCookie("abc")).toBe("***");
  });

  it("masks a different value to a different result, proving it isn't a hardcoded string", () => {
    expect(maskCookie("cookie-value-1234567890")).toBe("cook...7890");
    expect(maskCookie("cookie-value-1234567890")).not.toBe(maskCookie("sk-ant-sid01-abcdefghijklmnopqrstuvwxyz"));
  });
});

// ---------------------------------------------------------------------------
// ElectronSecretStore unit tests — Electron is mocked so the binary is never
// loaded. All fs calls use real temp dirs in test/helpers or are mocked here.
// ---------------------------------------------------------------------------

// We import ElectronSecretStore lazily inside each test to allow vi.mock to
// intercept the electron module before the first import.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => "secret_service"),
    encryptString: vi.fn((v: string) => Buffer.from(`enc:${v}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, "")),
  },
}));

async function getElectronMock() {
  const electron = await import("electron");
  return electron.safeStorage as unknown as {
    isEncryptionAvailable: Mock;
    getSelectedStorageBackend: Mock;
    encryptString: Mock;
    decryptString: Mock;
  };
}

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { ElectronSecretStore } from "../../../../src/main/adapters/electron/secretStore";

describe("ElectronSecretStore (credential-store spec: Encrypted-at-Rest Storage)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "aiquota-secret-store-"));
    const mock = await getElectronMock();
    mock.isEncryptionAvailable.mockReturnValue(true);
    mock.getSelectedStorageBackend.mockReturnValue("secret_service");
    mock.encryptString.mockImplementation((v: string) => Buffer.from(`enc:${v}`));
    mock.decryptString.mockImplementation((b: Buffer) => b.toString().replace(/^enc:/, ""));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("round-trips a credential through set() and get()", async () => {
    const store = new ElectronSecretStore(dir);

    await store.set("codex-1", "my-secret-token");

    expect(await store.get("codex-1")).toBe("my-secret-token");
  });

  it("returns null for a missing credential (ENOENT => null, not a thrown error)", async () => {
    const store = new ElectronSecretStore(dir);

    expect(await store.get("does-not-exist")).toBeNull();
  });

  it("delete() removes the credential so subsequent get() returns null", async () => {
    const store = new ElectronSecretStore(dir);
    await store.set("codex-1", "my-secret-token");

    await store.delete("codex-1");

    expect(await store.get("codex-1")).toBeNull();
  });

  it("writes the credential file with mode 0o600 (owner read/write only)", async () => {
    const store = new ElectronSecretStore(dir);

    await store.set("codex-1", "my-secret-token");

    const filePath = path.join(dir, "codex-1.enc");
    const stat = await fs.stat(filePath);
    // mode & 0o777 strips type bits; 0o600 = owner rw only
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("creates the base directory with mode 0o700 when it does not exist", async () => {
    const nestedDir = path.join(dir, "credentials");
    const store = new ElectronSecretStore(nestedDir);

    await store.set("codex-1", "my-secret-token");

    const stat = await fs.stat(nestedDir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("throws a TypedError('credential-broken') rather than returning null when decryption fails (fail-closed)", async () => {
    const store = new ElectronSecretStore(dir);
    await store.set("codex-1", "my-secret-token");

    // Make decryptString throw to simulate a keychain-level failure
    const mock = await getElectronMock();
    mock.decryptString.mockImplementation(() => {
      throw new Error("keychain error");
    });

    await expect(store.get("codex-1")).rejects.toMatchObject({ kind: "credential-broken" });
  });

  it("throws a TypedError('credential-broken') when safeStorage.isEncryptionAvailable() is false on set()", async () => {
    const mock = await getElectronMock();
    mock.isEncryptionAvailable.mockReturnValue(false);
    const store = new ElectronSecretStore(dir);

    await expect(store.set("codex-1", "secret")).rejects.toMatchObject({ kind: "credential-broken" });
  });

  it("throws a TypedError('credential-broken') when safeStorage uses the Linux basic_text backend (fake encryption)", async () => {
    const mock = await getElectronMock();
    mock.isEncryptionAvailable.mockReturnValue(true);
    mock.getSelectedStorageBackend.mockReturnValue("basic_text");
    const store = new ElectronSecretStore(dir);

    await expect(store.set("codex-1", "secret")).rejects.toMatchObject({ kind: "credential-broken" });
    await expect(store.get("codex-1")).rejects.toMatchObject({ kind: "credential-broken" });
  });

  it("normalizes a writeFile failure in set() to TypedError('credential-broken')", async () => {
    const store = new ElectronSecretStore(dir);
    const originalWriteFile = fs.writeFile;
    vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));

    await expect(store.set("codex-1", "secret")).rejects.toMatchObject({ kind: "credential-broken" });

    // Restore normal behavior to verify the credential was not persisted.
    vi.spyOn(fs, "writeFile").mockImplementation(originalWriteFile);
    await expect(store.get("codex-1")).resolves.toBeNull();
  });

  it("normalizes an rm failure in delete() to TypedError('credential-broken')", async () => {
    const store = new ElectronSecretStore(dir);
    await store.set("codex-1", "secret");
    const originalRm = fs.rm;
    vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("EPERM: operation not permitted"));

    await expect(store.delete("codex-1")).rejects.toMatchObject({ kind: "credential-broken" });

    vi.spyOn(fs, "rm").mockImplementation(originalRm);
    await expect(store.get("codex-1")).resolves.toBe("secret");
  });

  it("throws a TypedError('credential-broken') when safeStorage.isEncryptionAvailable() is false on get()", async () => {
    // Store a file first with encryption available
    const store = new ElectronSecretStore(dir);
    await store.set("codex-1", "secret");

    const mock = await getElectronMock();
    mock.isEncryptionAvailable.mockReturnValue(false);

    await expect(store.get("codex-1")).rejects.toMatchObject({ kind: "credential-broken" });
  });

  describe("path traversal protection (CRITICAL: credentialsRef must not escape baseDir)", () => {
    it("get() throws TypedError('credential-broken') for ../ traversal", async () => {
      const store = new ElectronSecretStore(dir);
      await expect(store.get("../../etc/passwd")).rejects.toMatchObject({ kind: "credential-broken" });
    });

    it("set() throws TypedError('credential-broken') for ../ traversal", async () => {
      const store = new ElectronSecretStore(dir);
      await expect(store.set("../../evil", "x")).rejects.toMatchObject({ kind: "credential-broken" });
    });

    it("delete() throws TypedError('credential-broken') for ../ traversal", async () => {
      const store = new ElectronSecretStore(dir);
      await expect(store.delete("../sibling/file")).rejects.toMatchObject({ kind: "credential-broken" });
    });

    it("get() throws TypedError('credential-broken') for absolute path injection", async () => {
      const store = new ElectronSecretStore(dir);
      await expect(store.get("/etc/passwd")).rejects.toMatchObject({ kind: "credential-broken" });
    });

    it("set() throws TypedError('credential-broken') for absolute path injection", async () => {
      const store = new ElectronSecretStore(dir);
      await expect(store.set("/tmp/evil", "x")).rejects.toMatchObject({ kind: "credential-broken" });
    });

    it("rejects a credentialsRef containing a path separator", async () => {
      const store = new ElectronSecretStore(dir);
      await expect(store.get("sub/dir")).rejects.toMatchObject({ kind: "credential-broken" });
    });

    it("accepts a valid alphanumeric-dash-underscore credentialsRef", async () => {
      const store = new ElectronSecretStore(dir);
      // Should not throw — codex-1, claude-personal, openai_api are representative
      await expect(store.set("codex-1", "secret")).resolves.toBeUndefined();
      await expect(store.get("codex-1")).resolves.toBe("secret");
      await expect(store.delete("codex-1")).resolves.toBeUndefined();
    });
  });
});

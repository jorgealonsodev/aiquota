// SPIKE S2 — throwaway harness, NOT part of the production build.
// See spikes/README.md for what this validates and how to run it.
//
// This script is never imported by production code and is excluded from
// tsconfig project references and the Vitest include glob.

const { app, BrowserWindow, session } = require("electron");
const { waitForEnterOrClosed, withTimeout } = require("./lib.cjs");

const LOAD_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 60_000;

// Intentionally reuses S1's session partition (persist:claude-spike-s1) so a
// login performed for S1 already carries cookies here — no second
// interactive sign-in required if S1 ran first in the same profile.
const PARTITION = "persist:claude-spike-s1";

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("[S2] Usage: npm run spike:s2 -- <orgId>");
    app.exit(1);
    return;
  }

  await app.whenReady();

  const ses = session.fromPartition(PARTITION);

  const loginWin = new BrowserWindow({
    width: 1024,
    height: 800,
    webPreferences: { session: ses },
  });
  await withTimeout(loginWin.loadURL("https://claude.ai"), LOAD_TIMEOUT_MS, "[S2] loadURL(login)");

  console.log("\n[S2] Log in to Claude in the opened window (skip if already logged in).");
  console.log("[S2] Press ENTER here once logged in to continue...\n");
  const outcome = await waitForEnterOrClosed(loginWin, "[S2]");
  if (outcome === "closed") {
    app.exit(1);
    return;
  }
  loginWin.close();

  const hiddenWin = new BrowserWindow({
    show: false,
    webPreferences: { session: ses },
  });

  await withTimeout(
    hiddenWin.loadURL("https://claude.ai"),
    LOAD_TIMEOUT_MS,
    "[S2] loadURL(hidden)",
  );

  const fetchScript = `
    fetch("https://claude.ai/api/organizations/${orgId}/usage", { credentials: "include" })
      .then(async (res) => ({
        status: res.status,
        bodySnippet: (await res.text()).slice(0, 300),
      }))
      .catch((err) => ({ error: String(err) }));
  `;

  const result = await withTimeout(
    hiddenWin.webContents.executeJavaScript(fetchScript),
    FETCH_TIMEOUT_MS,
    "[S2] executeJavaScript(fetch)",
  );

  console.log("[S2] Fetch result:", result);

  if (result && result.bodySnippet) {
    const challenged = /just a moment|cf-challenge|cf_chl/i.test(result.bodySnippet);
    console.log(`[S2] Cloudflare challenge detected: ${challenged}`);
  }

  const metrics = app.getAppMetrics();
  console.log("[S2] Process memory metrics (working set, MB):");
  for (const metric of metrics) {
    console.log(
      `  pid=${metric.pid} type=${metric.type} memory=${(metric.memory.workingSetSize / 1024).toFixed(1)}MB`,
    );
  }

  console.log("\n[S2] Done. Run `npm run spike:cleanup` to clear the stored session when finished.");
  app.quit();
}

main().catch((err) => {
  console.error("[S2] Spike failed:", err);
  app.exit(1);
});

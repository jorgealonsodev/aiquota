// SPIKE S2 — throwaway harness, NOT part of the production build.
// See spikes/README.md for what this validates and how to run it.
//
// This script is never imported by production code and is excluded from
// tsconfig project references and the Vitest include glob.

const { app, BrowserWindow, session } = require("electron");
const readline = require("node:readline");

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
  await loginWin.loadURL("https://claude.ai");

  console.log("\n[S2] Log in to Claude in the opened window (skip if already logged in).");
  console.log("[S2] Press ENTER here once logged in to continue...\n");
  await waitForEnter();
  loginWin.close();

  const hiddenWin = new BrowserWindow({
    show: false,
    webPreferences: { session: ses },
  });

  await hiddenWin.loadURL("https://claude.ai");

  const fetchScript = `
    fetch("https://claude.ai/api/organizations/${orgId}/usage", { credentials: "include" })
      .then(async (res) => ({
        status: res.status,
        bodySnippet: (await res.text()).slice(0, 300),
      }))
      .catch((err) => ({ error: String(err) }));
  `;

  const result = await hiddenWin.webContents.executeJavaScript(fetchScript);

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

  app.quit();
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once("line", () => {
      rl.close();
      resolve();
    });
  });
}

main().catch((err) => {
  console.error("[S2] Spike failed:", err);
  app.exit(1);
});

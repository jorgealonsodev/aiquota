// SPIKE S1 — throwaway harness, NOT part of the production build.
// See spikes/README.md for what this validates and how to run it.
//
// This script is never imported by production code and is excluded from
// tsconfig project references and the Vitest include glob.

const { app, BrowserWindow, session } = require("electron");
const readline = require("node:readline");

const PARTITION = "persist:claude-spike-s1";

async function main() {
  await app.whenReady();

  const ses = session.fromPartition(PARTITION);
  const win = new BrowserWindow({
    width: 1024,
    height: 800,
    webPreferences: { session: ses },
  });

  await win.loadURL("https://claude.ai");

  console.log("\n[S1] Log in to Claude in the opened window.");
  console.log("[S1] Once logged in, press ENTER here to read cookies...\n");

  await waitForEnter();

  const cookies = await ses.cookies.get({ domain: "claude.ai" });
  const lastActiveOrg = cookies.find((cookie) => cookie.name === "lastActiveOrg");

  if (lastActiveOrg) {
    console.log("[S1] FOUND lastActiveOrg cookie:");
    console.log(`  value present: ${Boolean(lastActiveOrg.value)}`);
    console.log(`  domain: ${lastActiveOrg.domain}`);
    console.log(`  expirationDate: ${lastActiveOrg.expirationDate ?? "session"}`);
  } else {
    console.log("[S1] NOT FOUND — no lastActiveOrg cookie on claude.ai.");
    console.log(
      "[S1] All cookies seen:",
      cookies.map((cookie) => cookie.name),
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
  console.error("[S1] Spike failed:", err);
  app.exit(1);
});

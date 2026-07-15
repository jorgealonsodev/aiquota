// Clears the shared spike session partition (cookies, cache, storage) so no
// Claude credentials linger on disk after S1/S2 are done. NOT part of the
// production build — see spikes/README.md.
//
// Run: npm run spike:cleanup

const { app, session } = require("electron");

const PARTITION = "persist:claude-spike-s1";

async function main() {
  await app.whenReady();

  const ses = session.fromPartition(PARTITION);
  await ses.clearStorageData();

  console.log(`[cleanup] Cleared all storage data for partition "${PARTITION}".`);
  app.quit();
}

main().catch((err) => {
  console.error("[cleanup] Failed:", err);
  app.exit(1);
});

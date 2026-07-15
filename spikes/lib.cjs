// Shared helpers for the throwaway Phase 0 spike harnesses.
// NOT part of the production build — see spikes/README.md.

const readline = require("node:readline");

/**
 * Waits for either ENTER on stdin or the given BrowserWindow being closed
 * by the user, whichever happens first. Prevents the harness from hanging
 * forever if the user closes the login window instead of returning to the
 * terminal.
 *
 * @param {import("electron").BrowserWindow} win
 * @param {string} label log prefix, e.g. "[S1]"
 * @returns {Promise<"enter" | "closed">}
 */
function waitForEnterOrClosed(win, label) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });

    const onEnter = () => {
      win.removeListener("closed", onClosed);
      rl.close();
      resolve("enter");
    };
    const onClosed = () => {
      rl.close();
      console.log(`${label} Window was closed before ENTER was pressed — aborting.`);
      resolve("closed");
    };

    rl.once("line", onEnter);
    win.once("closed", onClosed);
  });
}

/**
 * Rejects with a timeout error if the given promise does not settle within
 * `ms` milliseconds — avoids an indefinite hang on a stalled `loadURL` or
 * `executeJavaScript` call (e.g. a Cloudflare challenge that never resolves).
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { waitForEnterOrClosed, withTimeout };

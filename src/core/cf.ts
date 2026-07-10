// Pure Cloudflare-challenge escalation decision (design.md D4 / Spike
// Resolution S2). The shell (Phase 4) owns the actual hidden/visible
// BrowserWindow manipulation; this module only decides which mode the
// NEXT fetch attempt should use, given whether the CURRENT attempt hit a
// challenge and which mode it ran in.
export type FetchMode = "hidden" | "visible";

/**
 * Escalation table for the Claude hidden-fetch flow:
 * - hidden + challenge   -> visible (escalate immediately; hidden alone
 *   cannot clear a Cloudflare challenge).
 * - hidden + no challenge -> hidden (nothing to escalate, keep the
 *   resource-cheap hidden fetch).
 * - visible + challenge  -> visible (stay visible-foreground while the
 *   challenge persists).
 * - visible + no challenge -> hidden (challenge cleared: schedule a hidden
 *   retry for the next attempt to go back to the cheap path).
 *
 * With only two fetch modes, both "no challenge" branches converge to
 * "hidden" and both "challenge" branches converge to "visible" — lastMode
 * is still consulted explicitly below so the table reads as the full
 * 2x2 decision it represents, rather than hiding that symmetry.
 */
export function nextFetchMode(challengeDetected: boolean, lastMode: FetchMode): FetchMode {
  if (lastMode === "hidden") {
    return challengeDetected ? "visible" : "hidden";
  }
  return challengeDetected ? "visible" : "hidden";
}

// Pure Cloudflare-challenge escalation state machine (design.md D4 / Spike
// Resolution S2). D4 = "Claude fetch via a hidden BrowserWindow + in-page
// executeJavaScript fetch, with the escalation DECISION living in the pure
// domain core and only the actual window manipulation in the shell". S2 =
// the spike that must validate this approach's resident RAM and confirm a
// cleared Cloudflare challenge doesn't need re-clearing on every hidden
// fetch (see openspec/changes/aiquota-mvp/design.md "Open Questions" — S2
// remains pending manual execution; the CLEAN_VISIBLE_STREAK_BEFORE_HIDDEN_RETRY
// constant below may be tuned once it runs).
//
// The shell (Phase 4) owns the actual hidden/visible BrowserWindow
// manipulation; CfEscalation only decides which mode the NEXT fetch
// attempt should use, given the outcome of the current one. It is a pure,
// Clock-free state machine (only tracks counts), fully unit-testable.
export type FetchMode = "hidden" | "visible";

export interface CfDecision {
  mode: FetchMode;
  /**
   * True when a real, visible-foreground fetch still hit a Cloudflare
   * challenge — even a real browser window couldn't get through, so the
   * shell should surface a "provider unreachable" state to the user rather
   * than retrying silently.
   */
  unreachable: boolean;
}

/**
 * Number of consecutive clean (non-challenged) visible fetches required
 * before attempting a single hidden re-probe. Bounds hidden/visible
 * oscillation to at most 1-in-6 fetches during a persistent-challenge
 * period, instead of flipping mode on every single poll result.
 */
const CLEAN_VISIBLE_STREAK_BEFORE_HIDDEN_RETRY = 5;

/**
 * Tracks the hidden/visible fetch mode for one Claude instance's
 * Cloudflare-cleared fetch flow (design D4/S2):
 * - hidden + challenge -> escalate to visible immediately.
 * - visible: stays visible while challenges keep occurring (each one
 *   resets the clean streak and flags `unreachable`); after
 *   CLEAN_VISIBLE_STREAK_BEFORE_HIDDEN_RETRY consecutive clean fetches,
 *   the next attempt re-probes hidden once.
 * - hidden re-probe clean -> fully de-escalated, stays hidden.
 * - hidden re-probe challenged -> back to visible, streak reset (waits for
 *   another full clean run before probing again).
 */
export class CfEscalation {
  private mode: FetchMode = "hidden";
  private cleanVisibleStreak = 0;
  private probingHidden = false;

  /**
   * Records the outcome of the most recent fetch attempt and returns the
   * mode (+ unreachable flag) to use for the NEXT fetch attempt.
   */
  recordFetch(challengeDetected: boolean): CfDecision {
    if (this.mode === "hidden") {
      return this.recordHiddenFetch(challengeDetected);
    }
    return this.recordVisibleFetch(challengeDetected);
  }

  private recordHiddenFetch(challengeDetected: boolean): CfDecision {
    if (this.probingHidden) {
      this.probingHidden = false;
      if (challengeDetected) {
        this.mode = "visible";
        this.cleanVisibleStreak = 0;
        return { mode: this.mode, unreachable: false };
      }
      this.mode = "hidden";
      return { mode: this.mode, unreachable: false };
    }

    if (challengeDetected) {
      this.mode = "visible";
      this.cleanVisibleStreak = 0;
      return { mode: this.mode, unreachable: false };
    }

    return { mode: "hidden", unreachable: false };
  }

  private recordVisibleFetch(challengeDetected: boolean): CfDecision {
    if (challengeDetected) {
      // Even a real, visible window couldn't clear the challenge — reset
      // the streak and let the shell know the provider is unreachable.
      this.cleanVisibleStreak = 0;
      return { mode: "visible", unreachable: true };
    }

    this.cleanVisibleStreak += 1;
    if (this.cleanVisibleStreak >= CLEAN_VISIBLE_STREAK_BEFORE_HIDDEN_RETRY) {
      this.cleanVisibleStreak = 0;
      this.probingHidden = true;
      this.mode = "hidden";
      return { mode: "hidden", unreachable: false };
    }

    return { mode: "visible", unreachable: false };
  }
}

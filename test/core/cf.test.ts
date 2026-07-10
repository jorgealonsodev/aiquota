import { describe, expect, it } from "vitest";
import { CfEscalation } from "../../src/core/cf";

describe("CfEscalation (design D4/S2: Cloudflare hidden/visible hysteresis)", () => {
  it("starts hidden and stays hidden while fetches are clean", () => {
    const cf = new CfEscalation();

    const decision = cf.recordFetch(false);

    expect(decision).toEqual({ mode: "hidden", unreachable: false });
  });

  it("escalates to visible the moment a hidden fetch is challenged", () => {
    const cf = new CfEscalation();

    const decision = cf.recordFetch(true);

    expect(decision).toEqual({ mode: "visible", unreachable: false });
  });

  it("does not oscillate back to hidden after a single clean visible fetch", () => {
    const cf = new CfEscalation();
    cf.recordFetch(true); // escalate to visible

    const decision = cf.recordFetch(false); // 1 clean visible fetch

    expect(decision.mode).toBe("visible");
  });

  it("re-probes hidden only after 5 consecutive clean visible fetches", () => {
    const cf = new CfEscalation();
    cf.recordFetch(true); // escalate to visible

    let decision;
    for (let i = 0; i < 4; i += 1) {
      decision = cf.recordFetch(false);
      expect(decision.mode).toBe("visible");
    }
    decision = cf.recordFetch(false); // 5th consecutive clean visible fetch

    expect(decision.mode).toBe("hidden");
  });

  it("stays hidden (fully de-escalated) when the hidden re-probe comes back clean", () => {
    const cf = new CfEscalation();
    cf.recordFetch(true);
    for (let i = 0; i < 5; i += 1) cf.recordFetch(false);
    // The 6th decision returned above was "hidden" — the re-probe attempt.

    const decision = cf.recordFetch(false); // re-probe fetch outcome: clean

    expect(decision).toEqual({ mode: "hidden", unreachable: false });
  });

  it("returns to visible and resets the clean streak when the hidden re-probe is challenged", () => {
    const cf = new CfEscalation();
    cf.recordFetch(true);
    for (let i = 0; i < 5; i += 1) cf.recordFetch(false);
    // The 6th decision returned above was "hidden" — the re-probe attempt.

    const afterFailedProbe = cf.recordFetch(true); // re-probe fetch outcome: challenged
    expect(afterFailedProbe.mode).toBe("visible");

    // The streak reset: a single clean fetch must not immediately re-probe
    // again (no per-poll oscillation, at most 1-in-6 fetches probes hidden
    // during a persistent-challenge period).
    const decision = cf.recordFetch(false);
    expect(decision.mode).toBe("visible");
  });

  it("flags unreachable when a visible-mode fetch is still challenged", () => {
    const cf = new CfEscalation();
    cf.recordFetch(true); // escalate to visible

    const decision = cf.recordFetch(true); // visible fetch, still challenged

    expect(decision).toEqual({ mode: "visible", unreachable: true });
  });
});

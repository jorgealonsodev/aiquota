import { describe, expect, it } from "vitest";
import { NotifyEngine } from "../../src/core/notify";
import { WINDOW_KIND } from "../../src/shared/domain";

describe("NotifyEngine (notifications spec)", () => {
  it("fires a threshold-crossed event when utilization crosses a configured threshold", () => {
    const engine = new NotifyEngine();

    const events = engine.processWindow(
      { instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 82, resetsAt: "2026-07-10T12:00:00.000Z" },
      [80, 95],
    );

    expect(events).toEqual([
      {
        type: "threshold-crossed",
        instanceId: "claude-1",
        windowKind: WINDOW_KIND.FiveHour,
        threshold: 80,
        resetsAt: "2026-07-10T12:00:00.000Z",
      },
    ]);
  });

  it("fires each configured threshold independently within the same window generation", () => {
    const engine = new NotifyEngine();
    const resetsAt = "2026-07-10T12:00:00.000Z";
    const now = new Date("2026-07-10T11:00:00.000Z").getTime();

    const first = engine.processWindow({ instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 82, resetsAt }, [80, 95], now);
    const second = engine.processWindow({ instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 96, resetsAt }, [80, 95], now);

    expect(first.map((e) => e.threshold)).toEqual([80]);
    expect(second.map((e) => e.threshold)).toEqual([95]);
  });

  it("does not repeat a notification for the same (instanceId, windowKind, resetsAt, threshold) key", () => {
    const engine = new NotifyEngine();
    const resetsAt = "2026-07-10T12:00:00.000Z";
    const now = new Date("2026-07-10T11:00:00.000Z").getTime();
    const reading = { instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt };

    const first = engine.processWindow(reading, [80], now);
    const second = engine.processWindow(reading, [80], now);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("re-arms notifications when resetsAt changes (new window generation)", () => {
    const engine = new NotifyEngine();
    const first = engine.processWindow(
      { instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt: "2026-07-10T12:00:00.000Z" },
      [80],
    );
    const secondGeneration = engine.processWindow(
      { instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt: "2026-07-10T17:00:00.000Z" },
      [80],
    );

    expect(first).toHaveLength(1);
    expect(secondGeneration).toHaveLength(1);
  });

  it("fires a reconnect-needed event exactly once per auth-expired transition", () => {
    const engine = new NotifyEngine();

    const first = engine.processAuthStatus("codex-1", "auth-expired");
    const second = engine.processAuthStatus("codex-1", "auth-expired");
    const afterRecovery = engine.processAuthStatus("codex-1", "healthy");
    const thirdTransition = engine.processAuthStatus("codex-1", "auth-expired");

    expect(first).toEqual([{ type: "reconnect-needed", instanceId: "codex-1" }]);
    expect(second).toHaveLength(0);
    expect(afterRecovery).toHaveLength(0);
    expect(thirdTransition).toEqual([{ type: "reconnect-needed", instanceId: "codex-1" }]);
  });

  it("fires exactly at threshold equality (utilization 80 crossing threshold 80)", () => {
    const engine = new NotifyEngine();

    const events = engine.processWindow(
      { instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 80, resetsAt: "2026-07-10T12:00:00.000Z" },
      [80],
    );

    expect(events).toHaveLength(1);
    expect(events[0].threshold).toBe(80);
  });

  it("remove() evicts notify-once and auth-status state so a re-added instance notifies again", () => {
    const engine = new NotifyEngine();
    const resetsAt = "2026-07-10T12:00:00.000Z";
    engine.processWindow({ instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt }, [80]);
    engine.processAuthStatus("claude-1", "auth-expired");

    engine.remove("claude-1");

    const thresholdAgain = engine.processWindow(
      { instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt },
      [80],
    );
    const reconnectAgain = engine.processAuthStatus("claude-1", "auth-expired");

    expect(thresholdAgain).toHaveLength(1);
    expect(reconnectAgain).toHaveLength(1);
  });

  it("remove() only evicts the targeted instance, leaving others untouched", () => {
    const engine = new NotifyEngine();
    const resetsAt = "2026-07-10T12:00:00.000Z";
    const now = new Date("2026-07-10T11:00:00.000Z").getTime();
    engine.processWindow({ instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt }, [80], now);
    engine.processWindow({ instanceId: "codex-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt }, [80], now);

    engine.remove("claude-1");

    const codexRepeat = engine.processWindow(
      { instanceId: "codex-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt },
      [80],
      now,
    );

    expect(codexRepeat).toHaveLength(0); // codex-1's notify-once state is untouched by removing claude-1
  });

  it("prunes notify-once entries whose resetsAt has already passed real time", () => {
    const pastResetsAt = "2026-07-10T12:00:00.000Z";
    const fakeClock = { now: () => new Date("2026-07-10T13:00:00.000Z").getTime() };
    const engine = new NotifyEngine(fakeClock);

    engine.processWindow({ instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt: pastResetsAt }, [80]);

    // A later evaluation triggers pruning: the expired entry is evicted, so
    // even the same (already-elapsed) resetsAt can notify again — proving
    // the entry was actually removed from memory, not just logically
    // superseded (bounds growth for a long-running multi-day process).
    const afterPrune = engine.processWindow(
      { instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt: pastResetsAt },
      [80],
    );

    expect(afterPrune).toHaveLength(1);
  });
});

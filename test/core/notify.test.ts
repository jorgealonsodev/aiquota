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

    const first = engine.processWindow({ instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 82, resetsAt }, [80, 95]);
    const second = engine.processWindow({ instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 96, resetsAt }, [80, 95]);

    expect(first.map((e) => e.threshold)).toEqual([80]);
    expect(second.map((e) => e.threshold)).toEqual([95]);
  });

  it("does not repeat a notification for the same (instanceId, windowKind, resetsAt, threshold) key", () => {
    const engine = new NotifyEngine();
    const resetsAt = "2026-07-10T12:00:00.000Z";
    const reading = { instanceId: "claude-1", kind: WINDOW_KIND.FiveHour, utilization: 85, resetsAt };

    const first = engine.processWindow(reading, [80]);
    const second = engine.processWindow(reading, [80]);

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
});

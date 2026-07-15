import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeClock } from "../../../../src/main/adapters/electron/clock";

describe("NodeClock (design.md D1 real Clock port implementation)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("now() reflects the current time", () => {
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const clock = new NodeClock();

    expect(clock.now()).toBe(Date.parse("2026-07-10T12:00:00.000Z"));
  });

  it("setTimer() fires the callback after the requested delay, not before", () => {
    const clock = new NodeClock();
    const callback = vi.fn();

    clock.setTimer(callback, 1000);

    vi.advanceTimersByTime(999);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("clearTimer() prevents a scheduled callback from firing", () => {
    const clock = new NodeClock();
    const callback = vi.fn();

    const handle = clock.setTimer(callback, 1000);
    clock.clearTimer(handle);
    vi.advanceTimersByTime(2000);

    expect(callback).not.toHaveBeenCalled();
  });
});

// Real Clock port implementation (design.md D1), wrapping Node's global
// timer functions -- available in Electron's main process without any
// Electron-specific API. Thin shell with no branching logic: Scheduler's
// actual timing/backoff behavior is covered by the FakeClock-based unit
// tests in test/core/scheduler.test.ts (design.md Testing section).
import type { Clock } from "../../../core/scheduler";

export class NodeClock implements Clock {
  now(): number {
    return Date.now();
  }

  setTimer(callback: () => void, delayMs: number): unknown {
    return setTimeout(callback, delayMs);
  }

  clearTimer(handle: unknown): void {
    clearTimeout(handle as NodeJS.Timeout);
  }
}

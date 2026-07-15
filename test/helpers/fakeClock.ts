import type { Clock } from "../../src/core/scheduler";

interface ScheduledTimer {
  id: number;
  dueAt: number;
  callback: () => void;
}

/**
 * Deterministic Clock test double for Scheduler tests. Time only moves when
 * `advance()` is called, so backoff/interval math is exact and doesn't
 * depend on real wall-clock timing or vi.useFakeTimers() global patching.
 */
export class FakeClock implements Clock {
  private currentTime = 0;
  private timers: ScheduledTimer[] = [];
  private nextId = 1;

  now(): number {
    return this.currentTime;
  }

  setTimer(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, dueAt: this.currentTime + delayMs, callback });
    return id;
  }

  clearTimer(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  /**
   * Advances time by `ms`, firing any timers that became due, and flushes
   * microtasks after each callback so async poll() continuations (promise
   * .then chains inside Scheduler) settle before the next timer check.
   */
  async advance(ms: number): Promise<void> {
    this.currentTime += ms;

    let due = this.dueTimers();
    while (due.length > 0) {
      for (const timer of due) {
        timer.callback();
        await this.flushMicrotasks();
      }
      due = this.dueTimers();
    }
  }

  private dueTimers(): ScheduledTimer[] {
    const due = this.timers.filter((timer) => timer.dueAt <= this.currentTime);
    this.timers = this.timers.filter((timer) => timer.dueAt > this.currentTime);
    return due;
  }

  private async flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
}

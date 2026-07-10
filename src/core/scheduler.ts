// Pure per-instance polling scheduler (design.md "Scheduler & Notifications";
// polling-scheduler spec). Depends only on an injected Clock port — no
// setTimeout/setInterval, no Electron. The real Clock (Phase 3,
// src/main/adapters/electron/clock.ts) wraps Node's timer functions.
import { TypedError } from "../shared/domain";

export interface Clock {
  now(): number;
  /** Returns an opaque timer handle understood by clearTimer(). */
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * Backoff ladder in seconds for `network`/`provider-broken` failures
 * (design.md Scheduler & Notifications). Index N-1 is used after the Nth
 * consecutive failure; the ladder's last stage caps further failures.
 */
export const BACKOFF_LADDER_SECONDS: readonly number[] = [60, 300, 900, 1800];

export type PollFn = () => Promise<void>;

interface InstanceState {
  intervalMinutes: number;
  poll: PollFn;
  /** Consecutive network/provider-broken failures since the last success. */
  failureCount: number;
  /** True while suspended by an auth-expired failure (no automatic polls). */
  suspended: boolean;
  timer: unknown;
}

function classifyFailure(err: unknown): "auth-expired" | "network" | "provider-broken" {
  if (err instanceof TypedError) return err.kind;
  // A poll() that throws something other than TypedError is a programming
  // error in the caller, not a classified quota failure — treat it as the
  // safest classification (backs off, does not silently suspend polling).
  return "provider-broken";
}

export class Scheduler {
  private readonly instances = new Map<string, InstanceState>();

  constructor(private readonly clock: Clock) {}

  /** Starts (or restarts) polling `instanceId` on its own independent timer. */
  schedule(instanceId: string, intervalMinutes: number, poll: PollFn): void {
    this.cancel(instanceId);
    const state: InstanceState = {
      intervalMinutes,
      poll,
      failureCount: 0,
      suspended: false,
      timer: undefined,
    };
    this.instances.set(instanceId, state);
    this.armNormal(instanceId, state);
  }

  /** Stops polling `instanceId` and forgets its state. */
  cancel(instanceId: string): void {
    const state = this.instances.get(instanceId);
    if (state?.timer !== undefined) this.clock.clearTimer(state.timer);
    this.instances.delete(instanceId);
  }

  /**
   * Triggers an immediate poll for one instance, bypassing any backoff wait
   * or suspension. Does not affect any other instance's timer.
   */
  async refresh(instanceId: string): Promise<void> {
    const state = this.instances.get(instanceId);
    if (!state) return;
    this.clearArmedTimer(state);
    await this.runPoll(instanceId, state);
  }

  /** Triggers an immediate poll for every scheduled instance. */
  refreshAll(): Promise<void[]> {
    return Promise.all([...this.instances.keys()].map((instanceId) => this.refresh(instanceId)));
  }

  private clearArmedTimer(state: InstanceState): void {
    if (state.timer !== undefined) {
      this.clock.clearTimer(state.timer);
      state.timer = undefined;
    }
  }

  private armNormal(instanceId: string, state: InstanceState): void {
    const delayMs = state.intervalMinutes * 60_000;
    state.timer = this.clock.setTimer(() => {
      void this.runScheduledPoll(instanceId);
    }, delayMs);
  }

  private armBackoff(instanceId: string, state: InstanceState): void {
    const stageIndex = Math.min(state.failureCount - 1, BACKOFF_LADDER_SECONDS.length - 1);
    const delayMs = BACKOFF_LADDER_SECONDS[stageIndex] * 1000;
    state.timer = this.clock.setTimer(() => {
      void this.runScheduledPoll(instanceId);
    }, delayMs);
  }

  private async runScheduledPoll(instanceId: string): Promise<void> {
    const state = this.instances.get(instanceId);
    if (!state || state.suspended) return;
    await this.runPoll(instanceId, state);
  }

  private async runPoll(instanceId: string, state: InstanceState): Promise<void> {
    try {
      await state.poll();
      state.failureCount = 0;
      state.suspended = false;
      this.armNormal(instanceId, state);
    } catch (err) {
      const kind = classifyFailure(err);
      if (kind === "auth-expired") {
        state.suspended = true;
        // Deliberately no timer armed: auth-expired suspends scheduled
        // polling until a manual refresh succeeds (polling-scheduler spec).
      } else {
        state.failureCount += 1;
        this.armBackoff(instanceId, state);
      }
    }
  }
}

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
  /**
   * The in-progress poll attempt, if any. While set, neither a scheduled
   * timer firing nor a concurrent refresh() may start a second poll() call
   * for this instance — both coalesce onto this same promise instead.
   */
  inFlight: Promise<void> | null;
}

function classifyFailure(err: unknown): "auth-expired" | "network" | "provider-broken" {
  if (err instanceof TypedError && err.kind !== "credential-broken") return err.kind;
  if (err instanceof TypedError) return "provider-broken"; // credential-broken maps to provider-broken for scheduler
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
      inFlight: null,
    };
    this.instances.set(instanceId, state);
    this.armTimer(instanceId, state, intervalMinutes * 60_000);
  }

  /** Stops polling `instanceId` and forgets its state. */
  cancel(instanceId: string): void {
    const state = this.instances.get(instanceId);
    if (state?.timer !== undefined) this.clock.clearTimer(state.timer);
    this.instances.delete(instanceId);
  }

  /**
   * Triggers an immediate poll for one instance, bypassing any backoff wait
   * or suspension. Does not affect any other instance's timer. If a poll
   * for this instance is already in flight (e.g. a scheduled timer just
   * fired), coalesces onto that same attempt instead of starting a
   * duplicate concurrent poll.
   */
  async refresh(instanceId: string): Promise<void> {
    const state = this.instances.get(instanceId);
    if (!state) return;

    if (state.inFlight) {
      await state.inFlight;
      return;
    }

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

  /** Arms a single timer (normal interval or backoff delay) for `instanceId`. */
  private armTimer(instanceId: string, state: InstanceState, delayMs: number): void {
    state.timer = this.clock.setTimer(() => {
      void this.runScheduledPoll(instanceId);
    }, delayMs);
  }

  private async runScheduledPoll(instanceId: string): Promise<void> {
    const state = this.instances.get(instanceId);
    if (!state) return;

    // The timer that invoked this callback just fired; its handle is
    // stale regardless of what happens below, so clear it immediately
    // rather than leaving a dangling reference armed.
    state.timer = undefined;

    if (state.suspended) return;
    if (state.inFlight) return; // a concurrent poll (e.g. from refresh()) is already running; its own completion arms the next timer

    await this.runPoll(instanceId, state);
  }

  /** Starts a poll attempt, recording it as in-flight so concurrent callers coalesce onto it. */
  private runPoll(instanceId: string, state: InstanceState): Promise<void> {
    const attempt = this.executePoll(instanceId, state);
    state.inFlight = attempt;
    return attempt;
  }

  private async executePoll(instanceId: string, state: InstanceState): Promise<void> {
    try {
      await state.poll();
      state.failureCount = 0;
      state.suspended = false;
      this.armTimer(instanceId, state, state.intervalMinutes * 60_000);
    } catch (err) {
      const kind = classifyFailure(err);
      if (kind === "auth-expired") {
        state.suspended = true;
        // Deliberately no timer armed: auth-expired suspends scheduled
        // polling until a manual refresh succeeds (polling-scheduler spec).
      } else {
        state.failureCount += 1;
        const stageIndex = Math.min(state.failureCount - 1, BACKOFF_LADDER_SECONDS.length - 1);
        this.armTimer(instanceId, state, BACKOFF_LADDER_SECONDS[stageIndex] * 1000);
      }
    } finally {
      state.inFlight = null;
    }
  }
}

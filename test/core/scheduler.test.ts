import { describe, expect, it, vi } from "vitest";
import { BACKOFF_LADDER_SECONDS, Scheduler } from "../../src/core/scheduler";
import { TypedError } from "../../src/shared/domain";
import { FakeClock } from "../helpers/fakeClock";

const MINUTE_MS = 60_000;

/** A promise whose resolution is controlled externally, for deterministically
 * simulating an in-flight poll() that hasn't settled yet. */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("Scheduler (polling-scheduler spec)", () => {
  it("polls an instance on its configured interval", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    const poll = vi.fn().mockResolvedValue(undefined);

    scheduler.schedule("codex-1", 5, poll);
    await clock.advance(5 * MINUTE_MS - 1);
    expect(poll).not.toHaveBeenCalled();

    await clock.advance(1);
    expect(poll).toHaveBeenCalledTimes(1);

    await clock.advance(5 * MINUTE_MS);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("isolates instances: manual refresh of one does not disturb another's schedule", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    const pollA = vi.fn().mockResolvedValue(undefined);
    const pollB = vi.fn().mockResolvedValue(undefined);

    scheduler.schedule("instance-a", 5, pollA);
    scheduler.schedule("instance-b", 5, pollB);

    await clock.advance(2 * MINUTE_MS);
    await scheduler.refresh("instance-b");
    expect(pollB).toHaveBeenCalledTimes(1);
    expect(pollA).not.toHaveBeenCalled();

    await clock.advance(3 * MINUTE_MS);
    expect(pollA).toHaveBeenCalledTimes(1);
  });

  it("backs off on network/provider-broken failures following the ladder, and resets on success", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    let attempt = 0;
    const poll = vi.fn(async () => {
      attempt += 1;
      if (attempt <= 3) {
        throw new TypedError("network", "connection refused");
      }
    });

    scheduler.schedule("codex-1", 5, poll);

    await clock.advance(5 * MINUTE_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    await clock.advance(BACKOFF_LADDER_SECONDS[0] * 1000);
    expect(poll).toHaveBeenCalledTimes(2);

    await clock.advance(BACKOFF_LADDER_SECONDS[1] * 1000);
    expect(poll).toHaveBeenCalledTimes(3);

    await clock.advance(BACKOFF_LADDER_SECONDS[2] * 1000);
    expect(poll).toHaveBeenCalledTimes(4);

    await clock.advance(5 * MINUTE_MS);
    expect(poll).toHaveBeenCalledTimes(5);
  });

  it("caps backoff at the ladder's last stage on repeated failures", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    const poll = vi.fn().mockRejectedValue(new TypedError("provider-broken", "backend returned 503"));

    scheduler.schedule("codex-1", 5, poll);

    await clock.advance(5 * MINUTE_MS);
    await clock.advance(BACKOFF_LADDER_SECONDS[0] * 1000);
    await clock.advance(BACKOFF_LADDER_SECONDS[1] * 1000);
    await clock.advance(BACKOFF_LADDER_SECONDS[2] * 1000);
    expect(poll).toHaveBeenCalledTimes(4);

    await clock.advance(BACKOFF_LADDER_SECONDS[3] * 1000);
    expect(poll).toHaveBeenCalledTimes(5);

    await clock.advance(BACKOFF_LADDER_SECONDS[3] * 1000);
    expect(poll).toHaveBeenCalledTimes(6);
  });

  it("suspends scheduled polling on auth-expired without applying backoff", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    const poll = vi.fn().mockRejectedValue(new TypedError("auth-expired", "session expired", 401));

    scheduler.schedule("claude-1", 5, poll);
    await clock.advance(5 * MINUTE_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    await clock.advance(24 * 60 * MINUTE_MS);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("lets a manual refresh clear suspension and resume the normal schedule on success", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    let shouldFail = true;
    const poll = vi.fn(async () => {
      if (shouldFail) throw new TypedError("auth-expired", "session expired", 401);
    });

    scheduler.schedule("claude-1", 5, poll);
    await clock.advance(5 * MINUTE_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    shouldFail = false;
    await scheduler.refresh("claude-1");
    expect(poll).toHaveBeenCalledTimes(2);

    await clock.advance(5 * MINUTE_MS);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("lets manual refresh bypass backoff immediately, and advances the stage on failure like a scheduled attempt", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    const poll = vi.fn().mockRejectedValue(new TypedError("network", "timeout"));

    scheduler.schedule("codex-1", 5, poll);
    await clock.advance(5 * MINUTE_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    await scheduler.refresh("codex-1");
    expect(poll).toHaveBeenCalledTimes(2);

    await clock.advance(BACKOFF_LADDER_SECONDS[1] * 1000 - 1);
    expect(poll).toHaveBeenCalledTimes(2);
    await clock.advance(1);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("resumes the normal interval (not backoff) after a manual refresh succeeds mid-ladder", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    let shouldFail = true;
    const poll = vi.fn(async () => {
      if (shouldFail) throw new TypedError("network", "connection refused");
    });

    scheduler.schedule("codex-1", 5, poll);
    await clock.advance(5 * MINUTE_MS); // scheduled attempt 1: fails, stage -> ladder[0]=60s
    await clock.advance(BACKOFF_LADDER_SECONDS[0] * 1000); // scheduled attempt 2: fails, stage -> ladder[1]=300s
    expect(poll).toHaveBeenCalledTimes(2);

    shouldFail = false;
    await scheduler.refresh("codex-1"); // manual refresh succeeds mid-ladder (stage 2)
    expect(poll).toHaveBeenCalledTimes(3);

    // Success must reset to the normal 5-minute interval, not continue the
    // ladder (which would be ladder[2]=900s here if backoff had persisted).
    await clock.advance(5 * MINUTE_MS - 1);
    expect(poll).toHaveBeenCalledTimes(3);
    await clock.advance(1);
    expect(poll).toHaveBeenCalledTimes(4);
  });

  it("coalesces a manual refresh that arrives while a scheduled poll is still in flight", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    const deferred = createDeferred<void>();
    const poll = vi.fn(() => deferred.promise);

    scheduler.schedule("codex-1", 5, poll);
    await clock.advance(5 * MINUTE_MS); // fires the scheduled timer; poll() is now pending
    expect(poll).toHaveBeenCalledTimes(1);

    const refreshPromise = scheduler.refresh("codex-1"); // must coalesce, not call poll() again
    deferred.resolve();
    await refreshPromise;

    expect(poll).toHaveBeenCalledTimes(1);

    // Exactly one timer must be armed after settling: the next interval
    // fires exactly once more, never twice and never zero times.
    await clock.advance(5 * MINUTE_MS - 1);
    expect(poll).toHaveBeenCalledTimes(1);
    await clock.advance(1);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("coalesces two rapid refresh() calls into a single poll() invocation", async () => {
    const clock = new FakeClock();
    const scheduler = new Scheduler(clock);
    const deferred = createDeferred<void>();
    const poll = vi.fn(() => deferred.promise);

    scheduler.schedule("codex-1", 5, poll);
    const first = scheduler.refresh("codex-1");
    const second = scheduler.refresh("codex-1");

    expect(poll).toHaveBeenCalledTimes(1);

    deferred.resolve();
    await Promise.all([first, second]);

    expect(poll).toHaveBeenCalledTimes(1);
  });
});

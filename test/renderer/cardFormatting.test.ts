// Pure formatting helpers extracted from src/renderer/Card.tsx (quota-popup
// spec: "Per-Window Progress and Reset Countdown", "Last Update Timestamp
// and Manual Refresh"). Unit-tested directly here per this project's
// convention of splitting pure logic out of otherwise-untested shell/UI
// components (see design.md Testing Strategy).
import { describe, expect, it } from "vitest";
import { formatCountdown, formatLastUpdated } from "../../src/renderer/Card";

describe("formatCountdown (quota-popup spec: Countdown reflects remaining time)", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("shows hours and minutes when more than an hour remains", () => {
    const resetsAt = new Date(now.getTime() + 90 * 60 * 1000).toISOString();
    expect(formatCountdown(resetsAt, now)).toBe("1h 30m remaining");
  });

  it("shows only minutes when under an hour remains", () => {
    const resetsAt = new Date(now.getTime() + 45 * 60 * 1000).toISOString();
    expect(formatCountdown(resetsAt, now)).toBe("45m remaining");
  });

  it("shows a reset-now indicator once the reset time has already passed", () => {
    const resetsAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    expect(formatCountdown(resetsAt, now)).toBe("resets now");
  });

  it("falls back to an unknown indicator when resetsAt is null", () => {
    expect(formatCountdown(null, now)).toBe("resets unknown");
  });

  it("falls back to an unknown indicator when resetsAt is not a parseable date", () => {
    expect(formatCountdown("not-a-date", now)).toBe("resets unknown");
  });
});

describe("formatLastUpdated (quota-popup spec: Last update shown)", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("shows minutes since the last successful fetch", () => {
    const fetchedAt = now.getTime() - 3 * 60 * 1000;
    expect(formatLastUpdated(fetchedAt, now)).toBe("last updated 3 minutes ago");
  });

  it("shows a just-now indicator for a fetch under a minute old", () => {
    const fetchedAt = now.getTime() - 10 * 1000;
    expect(formatLastUpdated(fetchedAt, now)).toBe("last updated just now");
  });

  it("falls back to an unknown indicator when fetchedAt is undefined (never fetched)", () => {
    expect(formatLastUpdated(undefined, now)).toBe("last updated: unknown");
  });
});

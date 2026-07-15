import type { Settings } from "../../src/shared/domain";

/**
 * Builds a valid Settings fixture with sensible defaults, so individual
 * tests only need to override the fields they actually care about.
 * Defaults mirror the PRD example: pollIntervalMinutes 5, thresholds [80,95].
 */
export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    instances: [],
    pollIntervalMinutes: 5,
    thresholds: [80, 95],
    ...overrides,
  };
}

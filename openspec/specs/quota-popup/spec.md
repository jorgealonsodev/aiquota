# Quota Popup Specification

## Purpose

A frameless popup window, opened from the tray, shows per-account detail: one card per configured provider instance with per-window progress, reset countdowns, and manual refresh.

## Requirements

### Requirement: Popup Positioning and Close-on-Blur

The popup MUST be a frameless window anchored adjacent to the tray icon, and MUST close automatically when it loses focus (blur) or when the user clicks outside its bounds.

#### Scenario: Popup opens anchored to tray
- WHEN the user opens the popup from the tray icon
- THEN the window appears frameless and positioned adjacent to the tray icon

#### Scenario: Popup closes on blur
- GIVEN the popup is open
- WHEN the popup window loses focus
- THEN the popup closes automatically

### Requirement: Per-Account Card Rendering

The popup MUST render one card per enabled and configured provider instance, showing provider name, account label, and connection status. Disabled or unconfigured instances MUST NOT render a card.

#### Scenario: Card shown for configured instance
- GIVEN a Codex instance is enabled and has valid credentials
- WHEN the popup renders
- THEN a card for that instance appears with its provider name and label

#### Scenario: No card for unconfigured instance
- GIVEN a Claude instance has never completed login
- WHEN the popup renders
- THEN no card is shown for that instance

### Requirement: Per-Window Progress and Reset Countdown

Each card MUST show one progress element per active quota window returned by the adapter, displaying the usage percentage and a countdown to that window's reset time.

#### Scenario: Multiple windows on one card
- GIVEN an instance returns two active windows (e.g., a short and a long rolling window)
- WHEN the card renders
- THEN both windows appear with their own percentage and reset countdown

#### Scenario: Countdown reflects remaining time
- GIVEN a window's `resetsAt` is 90 minutes in the future
- WHEN the card renders
- THEN the countdown displays approximately 1h 30m remaining, updating as time passes

### Requirement: Last Update Timestamp and Manual Refresh

Each card MUST display the time of its instance's last successful fetch and MUST provide a manual refresh control that triggers an immediate poll for that instance.

#### Scenario: Last update shown
- GIVEN an instance last fetched successfully 3 minutes ago
- WHEN the card renders
- THEN it displays a "last updated 3 minutes ago" indicator

#### Scenario: Manual refresh triggers fetch
- WHEN the user clicks the refresh control on a card
- THEN that instance is polled immediately, independent of the scheduler's next scheduled tick

### Requirement: Error and Reconnect State Rendering

WHEN an instance's fetch fails or its credentials are invalid, its card MUST show an actionable error/reconnect state instead of stale or fabricated data, and MUST NOT cause other cards to fail to render.

#### Scenario: Reconnect prompt on auth failure
- GIVEN an instance's stored credential has expired
- WHEN the popup renders
- THEN that card shows a reconnect prompt while other cards render normally

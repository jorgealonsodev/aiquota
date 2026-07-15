# App Settings Specification

## Purpose

Lets the user enable/disable providers, configure the polling interval and notification thresholds, and defines how unconfigured or disabled providers are excluded from the rest of the app.

## Requirements

### Requirement: Provider Enable/Disable

The user MUST be able to enable or disable each provider instance independently. A disabled instance MUST be excluded from polling, popup rendering, and tray color/tooltip aggregation.

#### Scenario: Disabling a provider removes it everywhere
- GIVEN Claude is enabled and configured
- WHEN the user disables Claude in settings
- THEN Claude stops being polled, its card disappears from the popup, and it is excluded from tray color/tooltip

### Requirement: Polling Interval Setting

The user MUST be able to set the polling interval within the bounds defined by `polling-scheduler` (1–60 minutes, default 5).

#### Scenario: Changing the interval takes effect
- GIVEN the current interval is 5 minutes
- WHEN the user sets it to 15 minutes
- THEN subsequent polls for all enabled instances follow the new 15-minute cadence

### Requirement: Notification Threshold Setting

The user MUST be able to configure notification thresholds as a list of percentages (`number[]`), defaulting to `[80, 95]`, consumed by `notifications` to decide when to alert.

#### Scenario: Custom threshold applied
- GIVEN the user sets the thresholds to `[85]`
- WHEN an instance's window usage crosses 85%
- THEN a threshold-crossing notification fires at that value instead of any prior default

### Requirement: Manual Claude Org-ID Entry

WHEN the Claude adapter cannot resolve the organization ID from the `lastActiveOrg` cookie, settings MUST expose a manual org-ID input field for that instance, allowing the user to enter the org ID directly to complete configuration.

#### Scenario: Manual entry completes configuration
- GIVEN the `lastActiveOrg` cookie is absent for a Claude instance
- WHEN the user enters an org ID into the manual input field in settings
- THEN the instance becomes configured and quota fetching proceeds using that org ID

### Requirement: Unconfigured Provider Handling

A provider instance with no valid stored credential (never logged in, or credential removed) MUST be treated as unconfigured: it MUST be hidden from the popup and excluded from tray color/tooltip aggregation, distinct from a configured instance that is merely disabled.

#### Scenario: Never-configured provider stays invisible
- GIVEN a provider was never connected by the user
- WHEN the popup and tray render
- THEN no card, tooltip segment, or tray color contribution appears for that provider

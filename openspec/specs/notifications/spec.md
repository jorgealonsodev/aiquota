# Notifications Specification

## Purpose

Native OS notifications alert the user when a configured quota threshold is crossed, and when a provider instance needs reconnection, without repeating (spamming) for the same condition.

## Requirements

### Requirement: Threshold Crossing Notification

The system MUST fire a native OS notification when an enabled instance's window utilization crosses a configured threshold (e.g., moving from below to at/above the threshold).

#### Scenario: Threshold crossed triggers notification
- GIVEN a window's usage moves from 78% to 82% and the configured threshold is 80%
- WHEN the poll result is processed
- THEN a native notification is shown identifying the provider, instance, and window

#### Scenario: Two thresholds fire independently within one window generation
- GIVEN thresholds are configured as `[80, 95]` and a window's `resetsAt` has not changed
- WHEN usage crosses 80% on one poll and later crosses 95% on a subsequent poll within the same window generation
- THEN two separate notifications are sent, one for the 80% crossing and one for the 95% crossing, each fired exactly once

### Requirement: Notify-Once-Per-Window-Generation

For a given `(instanceId, windowType, resetsAt, threshold)` key, the system MUST NOT send more than one threshold-crossing notification while `resetsAt` remains unchanged, even if subsequent polls confirm usage is still at or above that threshold. Because `threshold` is part of the key, each configured threshold fires independently and exactly once per window generation.

#### Scenario: No repeat notification within the same window
- GIVEN a threshold-crossing notification was already sent for `(instanceId, windowType, resetsAt, threshold)`
- WHEN a later poll shows the same window still above that threshold with the same `resetsAt`
- THEN no additional notification is sent for that threshold

### Requirement: Notification State Reset on Window Rollover

WHEN a window's `resetsAt` value changes (the window has rolled over to a new generation), the notify-once state for that `(instanceId, windowType)` MUST reset, allowing a new threshold-crossing notification if applicable.

#### Scenario: New window generation re-enables notification
- GIVEN a window previously notified has now reset (`resetsAt` changed) and crosses the threshold again
- WHEN the poll result is processed
- THEN a new notification is sent for the new window generation

### Requirement: Reconnect Notification

The system MUST send a native notification when a provider instance transitions into a "needs reconnect" state (expired/invalid credentials), with an actionable path to the reconnect flow.

#### Scenario: Expired credential triggers reconnect notification
- GIVEN an instance's credential fails authentication
- WHEN the failure is detected
- THEN a notification is shown inviting the user to reconnect that instance

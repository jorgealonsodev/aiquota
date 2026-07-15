# Tray Status Specification

## Purpose

The system tray icon gives an at-a-glance aggregate view of quota health across all enabled and configured provider instances, with a tooltip summary and a context menu for common actions.

## Requirements

### Requirement: Aggregate Color Thresholds

The system MUST compute the tray icon color from the highest quota utilization percentage across all enabled and configured provider instances' active windows:
- green WHEN all percentages are `< 70`
- amber WHEN the highest is `>= 70` and `<= 90`
- red WHEN the highest is `> 90`
- gray WHEN no enabled/configured instance exists, or the enabled instances are all in an unrecoverable error/reconnect state

#### Scenario: All instances healthy and low usage
- GIVEN every enabled, configured instance has all windows below 70%
- WHEN the tray recomputes state
- THEN the icon color is green

#### Scenario: One instance crosses into warning range
- GIVEN at least one enabled instance has a window between 70% and 90% inclusive, and none exceed 90%
- WHEN the tray recomputes state
- THEN the icon color is amber

#### Scenario: One instance exceeds critical threshold
- GIVEN at least one enabled instance has a window above 90%
- WHEN the tray recomputes state
- THEN the icon color is red regardless of other instances' state

#### Scenario: No usable instance
- GIVEN all provider instances are disabled, unconfigured, or in an error state
- WHEN the tray recomputes state
- THEN the icon color is gray

### Requirement: Tooltip Summary

The tray icon tooltip MUST show one summary segment per enabled and configured provider instance, joined by ` · `, in the form `{ProviderLabel} {percent}%`, using each instance's highest active window percentage. An instance in error state SHOULD show an error indicator instead of a percentage.

#### Scenario: Tooltip reflects enabled providers only
- GIVEN Codex and Claude are enabled/configured and OpenCode is disabled
- WHEN the tooltip is generated
- THEN it lists only Codex and Claude segments, e.g. `Codex 34% · Claude 62%`

#### Scenario: Tooltip shows error state
- GIVEN an enabled instance's last fetch failed and needs reconnect
- WHEN the tooltip is generated
- THEN that instance's segment shows an error indicator instead of a stale or fabricated percentage

### Requirement: Context Menu Actions

The tray icon MUST expose a context menu with: Open, Refresh Now, Settings, Quit.

#### Scenario: Open shows the popup
- GIVEN the tray context menu is open
- WHEN the user selects "Open"
- THEN the popup window appears anchored near the tray icon

#### Scenario: Refresh triggers immediate poll
- WHEN the user selects "Refresh Now"
- THEN all enabled/configured instances are polled immediately, independent of their scheduled interval

#### Scenario: Quit terminates cleanly
- WHEN the user selects "Quit"
- THEN the application exits without leaving orphaned windows or processes

### Requirement: Multi-Instance Exclusion from Tray Color

Disabled or unconfigured provider instances MUST NOT contribute to tray color computation or tooltip content.

#### Scenario: Disabled provider excluded
- GIVEN a provider instance is disabled by the user
- WHEN tray color and tooltip are computed
- THEN that instance's windows are excluded from both computations

# Polling Scheduler Specification

## Purpose

Coordinates per-instance timers that trigger provider adapter fetches, with configurable intervals, manual refresh, and failure backoff isolated per instance.

## Requirements

### Requirement: Configurable Interval Bounds

The polling interval MUST be configurable between 1 and 60 minutes inclusive, with a default of 5 minutes when no user value is set.

#### Scenario: Default interval applied
- GIVEN the user has not changed the polling interval
- WHEN the scheduler starts
- THEN each enabled instance polls every 5 minutes

#### Scenario: Interval outside bounds rejected
- WHEN the user attempts to set an interval below 1 minute or above 60 minutes
- THEN the setting is rejected/clamped to the nearest bound and not applied as entered

### Requirement: Per-Instance Timer Isolation

Each `ProviderInstance` MUST have its own independent polling timer. A disabled or unconfigured instance MUST NOT be scheduled for polling.

#### Scenario: Disabling stops polling for that instance only
- GIVEN two enabled instances are actively polling
- WHEN the user disables one instance
- THEN that instance's timer stops while the other instance continues polling on its own schedule

### Requirement: Manual Refresh Trigger

The scheduler MUST support an on-demand refresh for a single instance or for all enabled instances, independent of each instance's scheduled interval, without disrupting other instances' timers.

#### Scenario: Manual refresh does not reset unrelated timers
- GIVEN instance A is due to poll in 3 minutes
- WHEN the user manually refreshes instance B
- THEN instance A's next scheduled poll still occurs in 3 minutes

### Requirement: Failure Backoff and Isolation

WHEN a scheduled fetch for an instance fails, the scheduler MUST branch on the failure's classification rather than applying a single blanket backoff:
- `network` and `provider-broken` failures MUST follow the existing backoff ladder, delaying that instance's next automatic attempt.
- `auth-expired` failures MUST instead suspend scheduled polling for that instance entirely until the user completes reconnect; the scheduler MUST NOT keep retrying an auth-expired instance on a timer. A manual refresh MUST remain allowed for a suspended instance and, if it succeeds, MUST clear the suspended state and resume normal scheduled polling.

In all cases, a single instance's failure MUST NOT affect other instances' timers or trigger a global halt.

#### Scenario: Failing instance backs off, others continue
- GIVEN an instance's fetch fails with a `network` or `provider-broken` classification
- WHEN the scheduler processes the failure
- THEN that instance's next poll is delayed by a backoff period while all other instances keep their normal schedule

#### Scenario: Auth-expired instance is suspended, not retried on a timer
- GIVEN an instance's fetch fails with an `auth-expired` classification
- WHEN the scheduler processes the failure
- THEN scheduled polling for that instance is suspended (no further automatic attempts) while other instances continue on their normal schedule

#### Scenario: Manual refresh clears suspension after reconnect
- GIVEN an instance is suspended due to an `auth-expired` failure
- WHEN the user reconnects and triggers a manual refresh that succeeds
- THEN the suspended state is cleared and the instance resumes normal scheduled polling

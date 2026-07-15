# Provider Adapters Specification

## Purpose

Defines the `QuotaProvider`/`ProviderInstance` contract and the Codex and Claude adapters, including their authentication cascades, error isolation, and the three design-time spikes (Claude org-ID resolution, Cloudflare-cleared background fetch, Codex error-state recovery) with acceptable fallback behavior.

## Requirements

### Requirement: QuotaProvider Contract

Each provider MUST implement a common interface: `id`, `configure()`, `fetchQuota(): QuotaWindow[]`, `authStatus()`. `QuotaWindow` MUST normalize provider-specific responses into a common shape carrying window type, usage percentage, and reset time/duration.

#### Scenario: Uniform consumption by scheduler and UI
- GIVEN both Codex and Claude adapters implement the contract
- WHEN the scheduler or popup consumes `fetchQuota()`
- THEN it handles both providers through the same `QuotaWindow[]` shape without provider-specific branching

### Requirement: ProviderInstance Multi-Instance Model

Each connection MUST be modeled as a `ProviderInstance { instanceId, providerId, label, credentialsRef }`. Adapters MUST be built to support N instances per provider even though the MVP exposes only one instance per provider in the UI.

#### Scenario: Instance identity drives isolation
- GIVEN two instances of the same provider exist
- WHEN either instance is configured, polled, or its credentials are stored
- THEN operations are scoped strictly to that instance's `instanceId` with no cross-instance leakage

### Requirement: Codex Dual Auth Cascade

The Codex adapter MUST attempt authentication in this order: (1) read a CLI token from `~/.codex/auth.json` (`%USERPROFILE%\.codex\auth.json` on Windows) with no browser involved; (2) IF absent, fall back to an integrated web login at `chatgpt.com` in an isolated session.

#### Scenario: Zero-config CLI path
- GIVEN a healthy `~/.codex/auth.json` exists
- WHEN the Codex instance is configured
- THEN quota is fetched using the CLI token with no login window shown

#### Scenario: Fallback to web login
- GIVEN no `~/.codex/auth.json` exists
- WHEN the Codex instance is configured
- THEN an isolated login window opens for `chatgpt.com` and the resulting session token is used

### Requirement: Codex 401 Recovery (Spike — accepted fallback)

The Codex adapter MUST classify fetch failures into distinct states rather than treating every non-2xx response as "needs reconnect":
- `401`/`403` MUST be classified as auth-expired, resulting in a "needs reconnect" state and a reconnect prompt directing the user to re-authenticate the CLI or complete the web-login fallback. It MUST NOT attempt an automatic token refresh, since no refresh mechanism is available from the verified data source.
- Transport-level errors (e.g., DNS failure, connection refused, timeout) MUST be classified as network errors, distinct from auth-expired, and MUST NOT surface a reconnect prompt.
- Any other non-2xx response (e.g., `429`, `5xx`) or a response body parse failure MUST be classified as provider-broken: the instance's card MUST show an error state and the scheduler MUST apply backoff, and a reconnect prompt MUST NOT be shown.

#### Scenario: 401 triggers reconnect prompt, not silent retry
- GIVEN the Codex CLI token has expired
- WHEN a fetch returns 401
- THEN the instance's `authStatus()` reports "needs reconnect" and no retry is attempted with the same token

#### Scenario: Server error shows provider-broken state, not reconnect
- GIVEN the Codex remote endpoint returns a 503
- WHEN the fetch fails
- THEN the instance's card shows a provider error state with backoff applied, and no reconnect prompt is shown to the user

### Requirement: Claude Cookie-Based Login

The Claude adapter MUST authenticate via an isolated `BrowserWindow`/session partition per instance: the user logs in at `claude.ai` inside that window, and the adapter captures the `sessionKey` session cookie afterward. No credentials are typed into the app directly.

#### Scenario: Cookie captured after login
- GIVEN the user completes login in the Claude login window
- WHEN the window reports a successful session
- THEN the `sessionKey` cookie is read from that session's cookie store and stored as the instance's credential

### Requirement: Claude Org-ID Discovery (Spike — accepted fallback)

The Claude adapter MUST resolve the organization ID in this order: (1) primary — read the `lastActiveOrg` cookie value from the login session; (2) fallback — IF the cookie is absent or unusable, prompt the user to enter the org ID manually in settings; (3) terminal — IF neither the cookie nor a manual entry yields a usable org ID, the adapter MUST report an unconfigured/needs-attention state and MUST NOT attempt a fetch. There is no normative requirement to call any "list my organizations" API endpoint, since no verified reference implementation for such an endpoint exists.

#### Scenario: Cookie-derived org ID
- GIVEN the `lastActiveOrg` cookie is present and valid after login
- WHEN the adapter configures the instance
- THEN the org ID is derived from the `lastActiveOrg` cookie value without user input

#### Scenario: Manual entry fallback
- GIVEN the `lastActiveOrg` cookie is absent or unusable
- WHEN the adapter configures the instance
- THEN the user is prompted to enter the org ID manually in settings, and that value is used once provided

#### Scenario: Terminal unconfigured state
- GIVEN the cookie is unusable and no manual org ID has been entered
- WHEN configuration completes
- THEN the instance is marked unconfigured with an actionable message, and quota fetch is not attempted

### Requirement: Claude Cloudflare-Cleared Fetch (Spike — accepted fallback)

Claude quota fetches MUST occur from a browser context that has cleared Cloudflare's bot challenge for the session. IF a hidden/background window cannot be verified to retain a cleared challenge state reliably, the adapter MUST fall back to performing the fetch from a visible window at poll time rather than silently failing.

#### Scenario: Background fetch from hidden window
- GIVEN the hidden window's session has previously cleared the Cloudflare challenge
- WHEN a scheduled poll runs
- THEN the fetch succeeds without showing any window to the user

#### Scenario: Fallback to visible-window fetch
- GIVEN background fetches are found unreliable for a given session state
- WHEN a scheduled poll runs
- THEN the adapter performs the fetch via a momentarily visible window rather than returning a false error

### Requirement: Per-Instance Error Isolation

A fetch failure, auth failure, or unhandled exception in one provider instance's adapter MUST NOT prevent other instances (same or different provider) from fetching and rendering normally.

#### Scenario: One provider down, others unaffected
- GIVEN Claude's fetch fails due to an expired session
- WHEN the scheduler runs its next cycle
- THEN Codex's instance still fetches and updates normally

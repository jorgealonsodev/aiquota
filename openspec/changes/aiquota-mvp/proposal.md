# Proposal: AIQuota MVP (Phase 1)

## Intent

Developers juggling several AI subscription plans (Claude, Codex) have no single place to see remaining quota per rolling window; today they open each web app or editor-bound extension. AIQuota is a cross-platform tray app (Linux + Windows) showing aggregate quota at a glance, with per-account detail and threshold alerts. This change bootstraps the greenfield repo and delivers the MVP feature set.

## Scope

### In Scope
- Project bootstrap: Electron + TypeScript + React/Vite + electron-builder, plus Vitest tooling (Strict TDD, no runner exists yet).
- System tray: aggregate color state (green/amber/red/gray), tooltip summary, context menu (Open, Refresh, Settings, Quit).
- Frameless popup: per-account cards with per-window progress bars, reset countdown, last-update time, manual refresh; closes on blur.
- Codex adapter: CLI-token path first (`~/.codex/auth.json` → `wham/usage`, no browser, no login).
- Claude adapter: integrated login (cookie capture from isolated Electron session) + org-ID discovery.
- Polling scheduler (1–60 min, default 5), per-instance isolation and backoff.
- Threshold notifications (configurable, notify-once per window generation).
- Settings, secure credential storage via `safeStorage` keyed by `instanceId`.
- Installers: AppImage/.deb (Linux), NSIS (Windows).
- Core built on the multi-instance `ProviderInstance` model (MVP exposes one account per provider).

### Out of Scope
- OpenCode Go adapter, multi-account UX, autostart, auto-update (Phase 2 — must not be blocked by architecture).
- macOS, usage history/charts (Phase 3).
- Codex local SQLite/Python token-telemetry path (different problem, adds a Python dependency).

## Capabilities

### New Capabilities
- `tray-status`: aggregate color, tooltip, context menu.
- `quota-popup`: frameless per-account cards, windows, refresh.
- `provider-adapters`: `QuotaProvider`/`ProviderInstance` contract, Codex + Claude adapters, typed errors.
- `polling-scheduler`: per-instance timers, backoff, failure isolation.
- `notifications`: threshold crossing, notify-once state machine, reconnect alerts.
- `credential-store`: `safeStorage`-backed, keyed by `instanceId`.
- `app-settings`: provider enable, interval, thresholds.
- `packaging`: electron-builder targets + test tooling.

### Modified Capabilities
- None (greenfield).

## Approach

Main process owns scheduler, tray, notifications, and encrypted credentials; typed IPC (contextIsolation on) to a React/Vite popup. Adapter pattern per provider, N-instance-ready from day one. Codex primary path is a plain authenticated HTTPS call. For Claude's Cloudflare-gated fetch, use a hidden `BrowserWindow` + `executeJavaScript` fetch (exploration Approach 3), validated by an early throwaway spike before locking design. Pure logic (parsing, color aggregation, notify-once, scheduler) extracted for Vitest with injected `fetch`/timers/`safeStorage`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/main/` | New | Scheduler, tray, notifications, IPC, credential store |
| `src/adapters/` | New | Codex + Claude adapters, provider contract |
| `src/renderer/` | New | React popup, cards |
| `src/shared/` | New | IPC types, domain models |
| `test/`, `vitest.config.ts` | New | Test tooling |
| `electron-builder.yml`, `package.json` | New | Build + packaging |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Claude org-ID auto-discovery has no reference impl | High | Design-time spike: find "list orgs" endpoint or fall back to `lastActiveOrg` cookie |
| Cloudflare clearing from hidden window unverified | High | Throwaway spike before design lock; fallback to visible-window fetch |
| Codex 401/refresh recovery has no precedent | Med | Design reconnect-prompt UX (re-login CLI/web), not in-app refresh |
| Internal/undocumented APIs break | High | Isolated per-provider errors, versioned adapters, fast releases |
| RAM budget (<150MB) vs resident hidden windows | Med | Measure on prototype; keep windows minimal |
| Notify-once semantics unspecified | Med | State machine keyed by `(instanceId, windowType, resetsAt)` |

## Rollback Plan

Greenfield: no production system to revert. Rollback = revert the feature branch / abandon the change folder. Spikes are throwaway and never merged into main design branches.

## Dependencies

- Reference repos in `repos-referencia/` (verified) for adapter seeds.
- System keychain (Secret Service/kwallet on Linux, DPAPI on Windows) for `safeStorage`.
- Node/Electron toolchain; no external Python runtime.

## Success Criteria

- [ ] Tray shows correct aggregate color and tooltip from live Codex + Claude data.
- [ ] Popup renders per-account cards with correct windows, percentages, and reset countdowns.
- [ ] Codex works with zero config when a healthy CLI session exists; Claude works after integrated login.
- [ ] Threshold notification fires once per window generation, no spam.
- [ ] Credentials stored encrypted, never in plaintext/logs.
- [ ] AppImage/.deb and NSIS installers produce a launchable app.
- [ ] Vitest suite green for adapter parsing, scheduler, color aggregation, and notify-once logic.

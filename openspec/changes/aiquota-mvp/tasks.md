# Tasks: AIQuota MVP (Phase 1)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3000–4500 (greenfield bootstrap + 8 capabilities; spikes are throwaway, excluded) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 bootstrap/tooling → PR2 domain core → PR3 adapters → PR4 shell/UI → PR5 packaging |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending (recommend: feature-branch-chain — strong linear dependency, rollback-friendly) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Bootstrap: scaffold, Vitest, shared contracts | PR1 | Base = tracker/main. ~300–500 lines. |
| 2 | Domain core, test-first (pure) | PR2 | Base = PR1 branch. ~800–1200 lines, still likely >400; split by file (aggregate/notify vs scheduler/settings/cf/store) into 2 commits min if reviewer load is a concern. |
| 3 | Provider adapters (pure) + electron port impls | PR3 | Base = PR2 branch. ~700–1000 lines; split Codex vs Claude as separate commits (Claude carries spike risk). |
| 4 | Electron shell (tray/windows/ipc/notifications) + renderer | PR4 | Base = PR3 branch. ~900–1300 lines; split shell vs renderer commits. Untested shell — manual QA notes per task. |
| 5 | Packaging + installer verification + full suite green | PR5 | Base = PR4 branch. ~100–200 lines. |

## Phase 0: Spikes (throwaway, not merged, do first — cheap validation)
- [x] 0.1a S1 harness implemented — `spikes/s1-claude-lastactiveorg.cjs` opens a Claude login window and reads `session.cookies.get` for `lastActiveOrg` once the user confirms login.
- [ ] 0.1b S1 executed and result recorded — requires a real interactive Claude login (agent cannot perform this). Run `npm run spike:s1`, then log the result in `design.md` under "Open Questions".
- [x] 0.2a S2 harness implemented — `spikes/s2-hidden-fetch-cf.cjs` opens a hidden `BrowserWindow` + `executeJavaScript` fetch to the Claude usage endpoint, prints Cloudflare-challenge heuristic and process memory metrics.
- [ ] 0.2b S2 executed and result recorded — requires a real interactive Claude login (agent cannot perform this). Run `npm run spike:s2 -- <orgId>`, measure resident RAM vs <150MB, confirm no repeat CF challenge (fallback: visible-window), then log the result in `design.md` under "Open Questions".

## Phase 1: Bootstrap & Tooling (PR1)
- [x] 1.1 `package.json` + TS project refs (main/preload/renderer/shared) + electron/vite/electron-builder deps.
- [x] 1.2 `vitest.config.ts` + `test` script; RED→GREEN smoke test `test/smoke.test.ts` proving the runner works (packaging spec: Test Tooling Bootstrap).
- [x] 1.3 `src/shared/domain.ts` — `QuotaProvider`, `ProviderInstance`, `QuotaWindow`, `WINDOW_KIND`, `AuthStatus`, `TypedError`, Settings types (design Interfaces/Contracts).
- [x] 1.4 `src/shared/ipc.ts` — typed channel map (`refresh`, `getState`, `openSettings`, `addAccount`, `getSettings`, `updateSettings`, `state:update`).

## Phase 2: Domain Core, Test-First (PR2, depends on Phase 1)
- [x] 2.1 RED `test/core/aggregate.test.ts`: color thresholds <70 green, 70–90 amber, >90 red, gray on empty/all-error; excludes unconfigured/error instances (tray-status spec).
- [x] 2.2 GREEN `src/core/aggregate.ts`.
- [x] 2.3 RED `test/core/notify.test.ts`: notify-once key `(instanceId,windowType,resetsAt,threshold)`, reset on `resetsAt` change, independent thresholds (notifications spec).
- [x] 2.4 GREEN `src/core/notify.ts`.
- [x] 2.5 RED `test/core/scheduler.test.ts`: per-instance timers, manual refresh bypasses backoff, ladder `[60,300,900,1800]s`, `auth-expired` suspends (no backoff), manual refresh clears suspension (polling-scheduler spec).
- [x] 2.6 GREEN `src/core/scheduler.ts` (injected `Clock`).
- [x] 2.7 RED `test/core/settings.test.ts`: schema validate, default-on-corruption, interval clamp 1–60 (app-settings spec).
- [x] 2.8 GREEN `src/core/settings.ts`.
- [x] 2.9 RED `test/core/cf.test.ts`: `nextFetchMode(challengeDetected,lastMode)` escalation table (design D4/S2).
- [x] 2.10 GREEN `src/core/cf.ts`.
- [x] 2.11 RED `test/core/store.test.ts`: state store update/merge per instance.
- [x] 2.12 GREEN `src/core/store.ts`.

## Phase 3: Provider Adapters, Test-First (PR3, depends on Phase 2) — COMPLETE
- [x] 3.1 RED `test/core/providers/codex.test.ts`: parse `wham/usage` fixtures, normalize primary/secondary→`WINDOW_KIND.FiveHour`/`SevenDay`, `resetsAt` cascade, classify 401/403→auth-expired, transport→network, 429/5xx/parse-fail→provider-broken (provider-adapters spec, Codex Dual Auth Cascade + 401 Recovery).
- [x] 3.2 GREEN `src/core/providers/codex.ts` (injected `HttpClient`).
- [x] 3.3 RED `test/core/providers/claude.test.ts`: normalize `five_hour`/`seven_day`, org-ID cascade cookie→manual→unconfigured, same error taxonomy (provider-adapters spec, Org-ID + Cloudflare-Cleared Fetch reqs).
- [x] 3.4 GREEN `src/core/providers/claude.ts` (fetch/parse only; window IO injected).
- [x] 3.5 `src/main/adapters/electron/clock.ts`, `httpClient.ts` — real `Clock`/`HttpClient` port impls (both fully unit-tested; no Electron dependency needed for either).
- [x] 3.6 `src/main/adapters/electron/secretStore.ts` — `safeStorage` get/set/delete keyed by `credentialsRef`, `maskCookie()` (credential-store spec). Both `maskCookie()` and `ElectronSecretStore` operations (get/set/delete, path traversal guard, missing-key fallback, safeStorage-unavailable, nested dir creation) are unit-tested via a mocked `electron` module (lazy-import avoids the binary-download side effect at module load — see apply-progress).
- [x] 3.7 `src/main/adapters/electron/settingsStore.ts` — read/write `userData/settings.json` via `src/core/settings.ts` (unit-tested against a real temp directory; no Electron dependency, `userDataDir` is injected by the caller).

## Final-Gate Critical Fixes (PR3 follow-up, autonomous commit batch)
- [x] F.1 Reject Electron `safeStorage` Linux `basic_text` backend in `src/main/adapters/electron/secretStore.ts`; throw `TypedError("credential-broken", ...)` when `getSelectedStorageBackend() === "basic_text"`.
- [x] F.2 Serialize concurrent `SettingsStore.save()` calls in `src/main/adapters/electron/settingsStore.ts` via a promise chain so an older invocation cannot overwrite a newer one.
- [x] F.3 Harden `src/core/providers/codex.ts` normalization: finite `used_percent` in [0, 100]; finite positive `reset_at`; skip non-object `additional_rate_limits` entries; normalize `authReader.read()` rejections to `TypedError("auth-expired", ...)`.
- [x] F.4 Normalize `ElectronSecretStore.set()`/`delete()` failures (encryptString, mkdir, writeFile, rm) to `TypedError("credential-broken", ...)`.

## Phase 4: Electron Shell (untested, manual QA) + Renderer (PR4, depends on Phase 2–3)
- [ ] 4.1 `src/main/index.ts` — bootstrap, wires scheduler/store/adapters. QA: app launches, tray visible.
- [ ] 4.2 `src/main/tray.ts` — icon color from `aggregate()`, tooltip, context menu Open/Refresh/Settings/Quit (tray-status spec). QA: manual click-through each menu item.
- [ ] 4.3 `src/main/windows.ts` — frameless popup (blur-close, anchored), Settings window, Claude login `BrowserWindow` per `session.fromPartition('persist:claude-{id}')`, hidden fetch window. QA: manual open/close/login flow, popup blur-close.
- [ ] 4.4 `src/main/ipc.ts` — wire `shared/ipc.ts` channels to core/store/adapters. QA: manually invoke each channel.
- [ ] 4.5 `src/main/notifications.ts` — native `Notification` from `NotifyEngine` events + reconnect notification. QA: manual threshold cross + reconnect trigger.
- [ ] 4.6 `src/preload/index.ts` — `contextBridge`, typed IPC only, no node exposure (D2 security).
- [ ] 4.7 `src/renderer/App.tsx` — subscribes `state:update`, renders card list.
- [ ] 4.8 `src/renderer/Card.tsx` — per-window progress, reset countdown, last-update, refresh button, error/reconnect state (quota-popup spec).
- [ ] 4.9 `src/renderer/Settings.tsx` — provider toggles, labels, interval, thresholds, manual org-ID field (app-settings spec).

## Phase 5: Packaging (PR5, depends on Phase 4)
- [ ] 5.1 `electron-builder.yml` — AppImage/.deb (Linux), NSIS (Windows), no macOS (packaging spec).
- [ ] 5.2 Manual QA: fresh install launches, tray icon appears, context menu opens.
- [ ] 5.3 Run full Vitest suite green; confirm coverage matches Testing Strategy table (core/providers/scheduler/aggregate/notify/settings/cf unit-tested; shell manual-QA only).

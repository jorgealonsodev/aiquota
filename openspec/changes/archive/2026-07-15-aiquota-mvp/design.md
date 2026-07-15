# Design: AIQuota MVP (Phase 1)

## Technical Approach

Hexagonal Electron app. A pure **domain core** (providers, normalization, scheduler, aggregation, notify-once) has zero Electron imports and receives `fetch`, `clock`, and `storage` via constructor injection so it is fully Vitest-unit-testable. Electron-bound code (tray, BrowserWindow, `safeStorage`, native `Notification`, IPC wiring) is a thin untested **shell** that adapts ports to Electron APIs. Renderer is a React+Vite popup that only renders view-models pushed over a typed IPC contract. Maps to proposal's main-owns-everything model and the `ProviderInstance` N-instance contract.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| D1 | Core/Electron boundary | Ports-and-adapters; domain depends on injected `HttpClient`/`Clock`/`SecretStore` interfaces | Electron APIs called directly in logic | Logic testable without Electron; shell stays thin |
| D2 | Renderer isolation | `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, preload `contextBridge` only | node in renderer | PRD §8 security; renderer never touches tokens |
| D3 | IPC surface | Single `shared/ipc.ts` typed channel map, imported by main+preload+renderer; renderer→main invoke (`refresh`,`getState`,`openSettings`,`addAccount`,`getSettings`,`updateSettings`), main→renderer push (`state:update`) | ad-hoc string channels | One source of truth, compile-time safety |
| D4 | Claude fetch (spike-2) | Hidden `BrowserWindow` per Claude instance, `webContents.executeJavaScript` in-page `fetch` (explore Approach 3); escalation DECISION logic lives in pure domain core, only window manipulation in shell | Playwright-core (2nd Chromium, RAM) / main `net.fetch` (CF state unverified) | Real browser fingerprint, no 2nd Chromium, <150MB, escalation testable |
| D5 | Codex recovery (spike-3) | Single error taxonomy: 401/403→`auth-expired` (reconnect prompt); transport/DNS/timeout→`network`; any other non-2xx (429,5xx) + parse fail→`provider-broken` (error card + backoff, NO reconnect). No in-app refresh | assume `refresh_token` grant; treat all non-2xx as auth-expired | No refresh precedent; a provider outage must never tell the user to re-login |
| D8 | Settings persistence | Typed JSON schema (non-secret only) in `app.getPath('userData')/settings.json`, validated on load, fallback to defaults on corruption | secrets in JSON; unvalidated read | Secrets stay in `safeStorage` (D2/§7); corruption-safe |
| D6 | Renderer stack | React+Vite | vanilla | Card list + reactive state; low cost |
| D7 | Build | electron-builder + Vite + TS project refs (`main`,`preload`,`renderer`,`shared`) | webpack/forge | Clean 4-target boundary, fast |

## Data Flow

    Scheduler(clock) ──tick──> ProviderInstance.fetchQuota()
         │                          │ (HttpClient injected)
         │                    QuotaWindow[] | TypedError
         ▼                          ▼
    StateStore ──> aggregate() ──> TrayState (color/tooltip)
         │              │
         │              └─> NotifyEngine(notify-once) ──> Notification
         └─IPC push (state:update)──> Preload ──> React popup cards

## Interfaces / Contracts

```ts
// shared/domain.ts
interface QuotaProvider {
  readonly providerId: 'codex' | 'claude';
  configure(instance: ProviderInstance): Promise<void>;
  fetchQuota(instance: ProviderInstance): Promise<QuotaWindow[]>; // throws TypedError
  authStatus(instance: ProviderInstance): Promise<AuthStatus>;
}
interface ProviderInstance { instanceId: string; providerId: string; label: string; credentialsRef: string; }
// Extensible window: kind is an open string with well-known constants; label is human-facing.
interface QuotaWindow { kind: string; /* WK.FiveHour|WK.SevenDay|codex primary/secondary|P2 rolling/weekly/monthly */ label: string; utilization: number; /*0-100*/ resetsAt: string|null; }
const WK = { FiveHour:'five_hour', SevenDay:'seven_day' } as const;
type AuthStatus = 'healthy'|'auth-expired'|'unconfigured';
class TypedError extends Error { constructor(readonly kind:'auth-expired'|'network'|'provider-broken', msg:string, readonly status?:number){super(msg);} }
// Settings (non-secret): { instances: SettingsInstance[]; pollIntervalMinutes: number; thresholds: number[] /* e.g. [80,95] */ }
// SettingsInstance extends ProviderInstance with { enabled: boolean; orgId?: string /* resolved Claude org ID — NOT a secret, lives here; safeStorage holds only sessionKey via credentialsRef */ }
// Ports (injected): HttpClient{ get(url,opts):Promise<Resp> }; Clock{ now():number; setTimer/clearTimer }; SecretStore{ get/set/delete(ref) }
```

**Normalization**: Codex `rate_limit.primary_window`→`{kind:WK.FiveHour,label:'Last 5 hours'}`, `secondary_window`→`{kind:WK.SevenDay,label:'Last 7 days'}` (extra `additional_rate_limits` map to their own kind/label without domain changes); `used_percent`→`utilization`; `resetsAt` = `reset_at`(epoch s→ISO) else `now+reset_after_seconds` else null. Claude `five_hour`/`seven_day` map 1:1 (`utilization` already 0-100, `resets_at` ISO). Both funnel into identical `QuotaWindow[]`.

### Adapters
- **Codex**: `configure` = cascade `getCodexHome()` (`CODEX_HOME` env → `~/.codex` / `%USERPROFILE%\.codex`) → read `auth.json` `tokens.{access_token,account_id}`; account_id resolves setting→auth.json→JWT `chatgpt_account_id` claim (base64url, no verify). `fetchQuota` = injected `HttpClient` GET `chatgpt.com/backend-api/wham/usage` with `Authorization: Bearer`, `originator: codex_vscode`, `ChatGPT-Account-Id`. No browser. Error classify (shared taxonomy, D5): 401/403→`auth-expired`; transport/DNS/timeout→`network`; any other non-2xx (429, 5xx) + parse fail→`provider-broken`.
- **Claude**: per-instance `session.fromPartition('persist:claude-{instanceId}')`. `configure` opens login `BrowserWindow`→claude.ai, waits for `sessionKey` cookie via `session.cookies.get`. **Org-ID (spike-1) — deterministic cascade**: (1) primary = `lastActiveOrg` cookie from the login session; (2) fallback = manual org-ID input field in settings; (3) terminal = instance `unconfigured`, no fetch attempted. (Non-normative: a future `list organizations` endpoint could replace step 2 if verified — not in the MVP contract, no reference impl exists.) `fetchQuota` = hidden-window `executeJavaScript` fetch `organizations/{orgId}/usage` (D4), with CF re-challenge detection polling `body.innerText` (escalation decision = pure core, see S2).

## Spike Resolution (primary / fallback — apply validates cheaply)

| Spike | Primary | Fallback |
|-------|---------|----------|
| S1 org-ID discovery | `lastActiveOrg` cookie value after login | manual org-ID input; terminal `unconfigured` (no list-orgs endpoint in contract) |
| S2 Cloudflare fetch | hidden BrowserWindow + in-page `executeJavaScript` fetch; pure-core `CfEscalation` state machine (revised below, apply-phase PR2 review) | visible/foreground window fetch while challenge persists |
| S3 Codex 401 recovery | 401/403 → `auth-expired` → reconnect-prompt → re-login CLI/web | non-auth failures → `provider-broken` error card + backoff, no reconnect |

## Scheduler & Notifications

Per-instance timer (interval 1–60min, default 5) via injected `Clock`. Each fetch wrapped in `allSettled`-style isolation: one instance failing never blocks others. On `TypedError` (`network`/`provider-broken`) apply exponential backoff `[60,300,900,1800]s`; success resets stage to 0. **Manual refresh** always executes immediately regardless of backoff state; on success it resets the backoff stage to 0, on failure it advances the stage as if it were a scheduled attempt. NotifyEngine holds a `Set` keyed `(instanceId, windowType, resetsAt, threshold)` — `windowType` here IS `QuotaWindow.kind` (two names for the same field; use `kind` in code, there is no separate `windowType` property) — where `thresholds: number[]` comes from settings (PRD example `[80,95]`): each threshold fires once when `utilization` crosses it; the key changes when `resetsAt` changes (new window generation), naturally re-arming every threshold. `auth-expired` emits a one-shot reconnect notification per transition; `provider-broken` never triggers a reconnect prompt. An instance in `auth-expired` **suspends scheduled polling** until reconnect completes (manual refresh is still allowed and can clear it) — a deliberate refinement of the polling-scheduler spec's blanket "failure → backoff" rule: auth failures do not back off, they suspend.

## Cloudflare Escalation (cf.ts) — REVISED apply-phase PR2 review

The original `nextFetchMode(challengeDetected, lastMode)` pure function was replaced by a stateful (but still Clock-free, still pure-count-based) `CfEscalation` class after review found the function-based version would oscillate hidden↔visible on every single poll whenever challenge results were mixed (e.g. clean/challenged/clean/challenged) — the function had no memory of *how many* clean fetches had occurred, only the single most recent one. `CfEscalation` fixes this with hysteresis:
- Starts `hidden`. A challenge while `hidden` escalates immediately to `visible`.
- While `visible`, each challenge resets a `cleanVisibleStreak` counter to 0 and reports `unreachable: true` (a real, visible-foreground fetch still failed — the shell can surface "provider unreachable" instead of silently retrying).
- Once `cleanVisibleStreak` reaches 5 consecutive clean `visible` fetches, the *next* fetch attempt re-probes `hidden` once (not every poll). If that hidden re-probe is clean, the instance is fully de-escalated back to `hidden`. If it's challenged, it returns to `visible` and the streak resets to 0 (another full run of 5 clean fetches is required before probing again).
- Net effect: at most 1-in-6 fetches attempts a hidden re-probe during a persistent-challenge period — no per-poll oscillation.

`recordFetch(challengeDetected): { mode, unreachable }` is called once per fetch attempt with that attempt's outcome, and returns the mode to use for the *next* attempt. The constant (5 consecutive clean fetches before a hidden re-probe) is a starting value, not yet spike-validated — S2 (below, still pending manual execution) may justify tuning it once real RAM/reliability data exists for the hidden-fetch approach.

## aggregate() Tray Contract

Pure `aggregate(snapshots): TrayState`. Error/`unconfigured` instances are **excluded** from the max-utilization computation (they surface an error indicator in the tooltip per tray-status spec). Color from max `utilization` across remaining healthy windows: **green** `< 70`, **amber** `70–90` (inclusive both ends), **red** `> 90`. **gray** only when zero enabled+configured instances exist OR every enabled instance is in error/reconnect state. Red wins regardless of how many instances error. Tooltip = per-instance `label pct%` (or error indicator) summary.

## Settings (app-settings)

Non-secret typed JSON `{ instances, pollIntervalMinutes, thresholds }` persisted to `app.getPath('userData')/settings.json`; validated against the schema on load, falling back to defaults on parse/validation failure (corruption-safe). Each instance entry carries `enabled: boolean` and an optional `orgId?: string` (resolved Claude org ID — not a secret). Secrets never live here — `sessionKey`/tokens stay in `safeStorage` keyed by `credentialsRef` (§7). Renderer reads/writes via `getSettings`/`updateSettings` IPC (D3). Rendered by a dedicated Settings window (`src/main/windows.ts` opens it; `src/renderer/Settings.tsx` renders provider toggles, per-instance labels, interval, thresholds, manual org-ID field).

## Project Layout

```
src/main/{index,tray,windows,ipc,notifications}.ts   (shell, thin)
src/main/adapters/electron/{httpClient,secretStore,clock,settingsStore}.ts (port impls)
src/core/{scheduler,aggregate,notify,store,settings,cf}.ts (pure, tested; settings=schema/validate, cf=CfEscalation hidden/visible hysteresis)
src/core/providers/{codex,claude}.ts                 (pure logic; browser IO injected)
src/preload/index.ts                                 (contextBridge)
src/renderer/{App,Card,Settings}.tsx  src/shared/{ipc,domain}.ts
test/**  vitest.config.ts  electron-builder.yml
```

## Testing Strategy (Strict TDD, Vitest)

| Layer | Test | Approach |
|-------|------|----------|
| Providers parse/normalize/error-classify | Unit | injected `HttpClient` fixtures; taxonomy 401/403→auth-expired, 429/5xx/parse→provider-broken, transport→network |
| Scheduler backoff/isolation + manual-refresh-vs-backoff | Unit | `vi.useFakeTimers()` + injected `Clock`; assert manual bypasses backoff, resets on success, advances on failure |
| aggregate() tray color (70/90 bounds, gray), notify-once FSM per threshold | Unit | pure fn tables incl. `thresholds[]` and resetsAt/threshold key change |
| Settings schema validate + default-on-corruption | Unit | pure `settings.ts` parse fixtures |
| CF escalation `CfEscalation` state machine | Unit | pure `cf.ts` recordFetch() sequences: hidden-challenge escalation, 5-clean-streak hidden re-probe, probe-clean de-escalation, probe-challenged reset, visible-challenge unreachable flag |
| SecretStore keying/encoding | Unit | fake `SecretStore` (real keychain = manual) |
| Tray/BrowserWindow/IPC wiring, login cookie capture, actual window show/hide manipulation | Untested shell | manual QA checklist |

## Security Posture (PRD §7)

`safeStorage`-encrypted tokens keyed by `credentialsRef=instanceId`; never plaintext/config-JSON/logs; `maskCookie()` for debug. Credentials confined to each provider's official domain via per-instance partition. Renderer sandboxed, no token access — only view-models cross IPC.

## Migration / Rollout

No migration (greenfield). Spikes are throwaway, never merged.

## Open Questions

- [ ] S1: confirm `lastActiveOrg` cookie is set post-login (apply spike) before committing away from manual input.
- [ ] S2: measure resident RAM of hidden windows vs <150MB budget on prototype. Still pending manual execution as of the Phase 2 apply batch; once it runs, may justify tuning `CfEscalation`'s `CLEAN_VISIBLE_STREAK_BEFORE_HIDDEN_RETRY` constant (currently 5) based on real reliability/RAM data.

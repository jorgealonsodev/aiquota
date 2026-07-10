# Spikes (Phase 0 — throwaway)

These scripts are **not part of the production build**. They exist only to
validate two open design assumptions (see `design.md` Open Questions) before
Phase 3 implements the real Claude adapter. They are excluded from the
TypeScript project references (`tsconfig.json`) and from the Vitest include
glob (`test/**`), and MUST NOT be imported by any file under `src/`.

Both spikes require a real Claude account and an interactive login. They
cannot be run unattended, so they are not part of the automated Strict TDD
cycle — status is tracked in apply-progress as **"harness ready, manual run
pending"**.

## S1 — `lastActiveOrg` cookie after login

**Question**: Does Claude set a `lastActiveOrg` cookie after login, so the
org-ID resolution cascade (design: cookie -> manual input -> unconfigured)
can rely on it as the primary source?

```bash
npm run spike:s1
```

1. A window opens at `https://claude.ai`. Log in manually.
2. Press ENTER in the terminal once logged in.
3. The script reads cookies on the `claude.ai` domain and prints whether
   `lastActiveOrg` exists, its domain, and expiry.

Record the result in `design.md` under "Open Questions" once run.

## S2 — Hidden-window fetch + Cloudflare + RAM

**Question**: Can a hidden `BrowserWindow` run an in-page `fetch()` against
the Claude usage endpoint without re-triggering a Cloudflare challenge, and
does its resident memory stay under the ~150MB budget?

```bash
npm run spike:s2 -- <orgId>
```

1. A visible window opens at `https://claude.ai` for login (reuses the same
   session partition as S1 — run S1 first, or log in again here).
2. Press ENTER once logged in; the visible window closes.
3. A hidden window loads `claude.ai` and runs `fetch()` in-page against
   `/api/organizations/<orgId>/usage`, printing the response status, a body
   snippet, and a Cloudflare-challenge heuristic match.
4. Process memory metrics (`app.getAppMetrics()`) are printed for comparison
   against the <150MB budget.

Record the result in `design.md` under "Open Questions" once run.

**Note**: S2 intentionally reuses S1's session partition
(`persist:claude-spike-s1`) — if S1 already ran and logged in, S2's login
window will already be authenticated and you can press ENTER immediately.

## Cleanup — clear the stored Claude session

Both spikes share one session partition (`persist:claude-spike-s1`) that
persists cookies (including the Claude session) to disk between runs. Once
you are done with both spikes, clear it:

```bash
npm run spike:cleanup
```

This calls `session.clearStorageData()` on the shared partition. Run it
before deleting the repo checkout or handing the machine to someone else.

## Hang protection

Both spikes fail fast instead of blocking forever:
- If you close the login window instead of pressing ENTER, the script
  detects the `closed` event and exits with an error instead of hanging on
  stdin.
- S2 wraps `loadURL` and `executeJavaScript` in a 60s timeout so a stalled
  page load or an unresolved Cloudflare challenge cannot hang the process
  indefinitely.

## Status

| Spike | Status |
|-------|--------|
| S1 | Harness ready, manual run pending |
| S2 | Harness ready, manual run pending |

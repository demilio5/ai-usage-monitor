# Mozilla reviewer notes — AI Usage Monitor

Distribution requested: unlisted, signed self-distribution. The signed XPI is intended for permanent installation in desktop Firefox; this submission is not a request for a public AMO listing.

## Build from source

Node.js >=22.19 (tested locally with 26.8.1); npm. The build is platform-independent.

```
npm ci
npm run build
```

Output is dist/. TypeScript is bundled with esbuild, without minification or remote runtime dependencies. package-lock.json pins all development dependencies. The source archive contains original source, tests, licenses and complete build scripts; it excludes dependencies, research clones, browser profiles, account data and output artifacts.

Optional validation: `npm run check`. The automated unit/integration suite currently has 70 passing tests. Mozilla Add-ons Linter reports zero warnings/errors. Isolated Firefox 158.0 installation and UI tests pass. `npm run test:firefox` additionally requires Firefox and downloads geckodriver 0.37.1 from Mozilla's GitHub release on first use; it uses only a temporary test profile and blocks provider network traffic. Driver-injected test fixtures never ship in dist/.

## Purpose and usage

Monitor reported subscription quota metadata from Claude and Codex, with local history, reset countdowns, optional forecasts, and toolbar percentages. Regular ChatGPT's general quota is explicitly unavailable because no verified global percentage is known. This extension does not monitor API costs or conversation content.

Users sign into their own accounts on claude.ai and chatgpt.com in Firefox. They never type credentials into this extension. Authentication cookies are attached by Firefox. Container/private-only logins may not work; private browsing is disabled.

Claude and Claude Code share subscription allowances; they are displayed as one provider. Codex uses its separate reported usage windows, not a general ChatGPT message meter. Actual quota acceptance needs real-account validation; internal endpoints and plan schemas may change.

## Network requests and authorization

Read-only HTTPS GET only:

- https://claude.ai/api/organizations
- https://claude.ai/api/organizations/{id}/usage
- https://chatgpt.com/api/auth/session
- https://chatgpt.com/backend-api/wham/usage

The HTTP helper allowlists these paths and rejects redirects. No cookies-reading permission, webRequest interception, content script, external relay, native helper or conversation endpoint is present.

Codex reads accessToken from the existing ChatGPT session in memory on each collection, sends it as Authorization: Bearer only to the exact same-origin WHAM usage endpoint, then drops all session fields from the returned provider state. Recognized account metadata supplies ChatGPT-Account-Id when available. The HTTP helper prohibits sending bearer authorization to any other URL, including Claude and auth/session. Tokens and raw session payloads are never persisted, exported, synced or logged. Tests verify the returned provider state and persisted storage exclude synthetic secrets and profile data. No reviewer credentials or tokens are supplied in this submission; use your own test session if available.

No telemetry, analytics, third-party quotas transmission, remote code or remote dependencies. Browser storage is local only. Host permissions are limited to claude.ai and chatgpt.com; Firefox grants them at origin scope even though code allows just these routes.

## Permissions

Required storage: preferences, current quota metadata, last-success/diagnostic state, alert deduplication and bounded local history. Required alarms: a one-minute event-page scheduler; actual network requests obey configured intervals and persisted eligibility times.

Optional notifications: off by default, requested only when enabled in Settings. Optional idle: off by default, requested only when the user enables Reduce refresh while idle. Idle detection uses a 10-minute threshold; polling then slows to at most hourly while preserving longer 12/24-hour settings. No keyboard/mouse events, application names or activity history are recorded. Server Retry-After and backoff apply even to manual requests or permission/settings changes.

## UI checks without a paid service account

1. Install: a popup displays unavailable/auth/network states honestly without synthetic percentages. The default two-row toolbar icon shows large numbers for Claude above Codex, using dashes when unavailable. The optional single badge is in Settings.
2. Open the popup: normal three-provider overview fits within 600px. History and diagnostics are in the Settings tab.
3. Refresh never submits prompts, starts chats or consumes subscription inference allowance. It only requests usage metadata.
4. Settings support provider enable/disable, theme, badge mode, optional alerts/idle detection and intervals through 24 hours. Data export is a local CSV; Clear history asks for confirmation.
5. With a signed-in session, compare reported percentages/reset times to service dashboards. On failures, previous readings remain marked stale; expiry never invents a 100% replenishment.

Privacy details: PRIVACY.md. Security model: SECURITY.md. MIT reference-project copyrights: THIRD_PARTY_NOTICES.md, also packaged in the extension. These public open-source provider schemas informed a new TypeScript implementation; entire upstream extensions are not bundled.

The extension uses the unlisted distribution channel with an HTTPS update feed at https://demilio5.github.io/ai-usage-monitor/updates.json. Signed XPIs and SHA-256 update hashes are published in its own GitHub repository. Signing credentials are Windows Credential Manager entries and are never included in the extension or source archive.

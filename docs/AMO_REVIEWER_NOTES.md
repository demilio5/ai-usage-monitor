# Mozilla reviewer notes — AI Usage Monitor

Unlisted self-distribution for desktop Firefox. No public AMO listing requested.

## Build

Node.js >=22.19 and npm. Run `npm ci`, then `npm run build`. Output: dist/.
TypeScript is bundled by esbuild without minification or remote runtime dependencies. package-lock.json pins dependencies. The source archive includes source, tests, licenses and build scripts; excludes dependencies, browser profiles, account data and output artifacts.

Validation: `npm run check` runs tests, type checking, build and self-hosted Add-ons Linter. `npm run test:firefox` uses a temporary Firefox profile, downloads geckodriver on first use and blocks provider traffic. Injected fixtures never ship.

## Purpose and authentication

Displays Claude/Claude Code shared subscription allowances and separate Codex quotas, reset dates, local history, forecasts and toolbar percentages. General ChatGPT quota is unavailable. No conversation content or API cost monitoring.

Users sign into claude.ai and chatgpt.com in regular Firefox tabs. Firefox attaches cookies; no credentials are entered in the extension. Private browsing is disabled. Internal provider schemas may change.

Read-only HTTPS GET routes:
- claude.ai/api/organizations
- claude.ai/api/organizations/{id}/usage
- chatgpt.com/api/auth/session
- chatgpt.com/backend-api/wham/usage

The HTTP helper allowlists these paths and rejects redirects. Codex uses the session accessToken in memory only, as a bearer to the same-origin WHAM endpoint; recognized account metadata supplies ChatGPT-Account-Id. Session fields are discarded. Tokens and raw session payloads are never stored, exported, synced or logged. No reviewer credentials supplied; use your own session if available.

No telemetry, remote code, third-party relay, content scripts, cookie-reading permission or conversation requests. Host access is limited to Claude and ChatGPT.

## Permissions and checks

Storage holds preferences, quota metadata, diagnostics, alert deduplication and bounded local history. Alarms schedule collection; requests obey configured intervals, backoff and Retry-After.

Optional notifications and idle are off by default. Idle detection after 10 minutes slows polling to at most hourly, preserving longer intervals. No typed content, app names or activity history is recorded.

The popup shows honest unavailable/auth states without fake percentages. Refresh requests usage metadata only. Failures retain stale readings; expiry never invents replenishment. Settings include themes, intervals, toolbar modes and alerts. CSV export stays local; clearing history asks confirmation.

See PRIVACY.md, SECURITY.md and THIRD_PARTY_NOTICES.md. MIT licensed. Signed releases and the HTTPS update feed are hosted in demilio5/ai-usage-monitor on GitHub. Signing credentials are excluded from all archives.

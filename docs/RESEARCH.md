# Research and implementation decisions

Source inspection date: 2026-10-19. All three requested repositories existed, were cloned successfully, and had MIT licenses. Commits are pinned in THIRD_PARTY_NOTICES.md. Local clones in research/ are excluded from the build and source control.

| Repository | Inspected implementation | Firefox compatibility | Assessment |
| --- | --- | --- | --- |
| claude-monitor/claude-monitor-browser-extension | extension/background.js: organization discovery, credentialed GET, five_hour/seven_day utilization, alarms, badge, history, alerts | Dedicated MV3 manifest with background.scripts | Useful reference for Claude cookie-only requests and Firefox event pages. Its optional stream interceptor and uninstall survey are not included. |
| cupcakedev/ai-usage-extension | src/background/services/UsageService.ts: Claude organization and usage calls; Codex auth/session then WHAM with Authorization | Inspected manifest uses Chrome service_worker and cookies permission | Useful provider schema reference, not directly portable. No verified overall ChatGPT percentage was found in the inspected usage service despite broad marketing wording. |
| SysAdminDoc/AI-Usage_Tracker | src/scrapers/claude.js, codex.js, src/background.js, manifests/firefox.json | Dedicated Firefox MV3 script/module build | Useful schema guards and failure-state reference. Its Codex auth flow informed the in-memory authentication added with explicit user authorization in v1.0.1. Native scheduler, MCP, API billing, page interception and userscripts are outside this extension. |

## What was verified

Ran upstream Tracker `node build/test-scrapers.mjs` and `node build/test-schema-sentinels.mjs`: provided JSON, auth-contract, schema, and failure-preservation fixtures passed. The scraper script skipped absent Claude.mhtml and Codex.mhtml fixtures. These are mocked/source-contract checks, not successful requests against a real account. No claim is made that all upstream advertised features work.

The new implementation has its own mocked provider, forecasting, storage, toolbar, retry, notification, and background integration tests. See VALIDATION.md for browser results. Real authenticated endpoint acceptance cannot be verified without the user's Firefox sessions and remains a release gate.

## Data sources and restrictions

Claude: read-only GET https://claude.ai/api/organizations, then /api/organizations/{id}/usage. Supported fields: five_hour and seven_day plus seven_day_* model caps, utilization in 0–100 percent, resets_at as an ISO timestamp with timezone. Uses credentials:include so Firefox handles session cookies. Multiple memberships require a configured organization ID; the extension never silently chooses a workspace. No API cost, extra credits, or messages are inferred. Missing fields are unavailable. Some plans do not expose these windows.

Codex: read-only GET https://chatgpt.com/backend-api/wham/usage. Parses rate_limit.primary_window and secondary_window, used_percent, reset_at (epoch seconds), and limit_window_seconds. Labels five-hour and weekly windows only when their reported duration matches. v1.0.1 uses browser-managed cookies to GET /api/auth/session, reads accessToken locally to the provider call, and sends Authorization: Bearer only to the exact same-origin WHAM endpoint. Recognized account metadata supplies ChatGPT-Account-Id when available. The user explicitly authorized this change from the original restriction. No session response or token is stored, exported, returned as provider state, or logged. Real-account acceptance remains unverified.

Regular ChatGPT: no verified general subscription quota percentage found. The adapter reports unavailable without making speculative network calls. The Codex meter must not be presented as ChatGPT message quota.

These are undocumented web endpoints, not supported public subscription APIs. They can change, return challenges, require access not granted by the browser, or cease to exist. No access-control or rate-limit bypass is attempted. No cookies API, webRequest interception, page-world injection, password prompt, token storage, token export, API key, or local CLI credential access is implemented.

Firefox containers and private sessions may hold separate cookies from the extension's background context. This release uses the default profile session only. Browser challenges and cookie partitioning can prevent collection even when a website tab is signed in.

## Allowance relationships

Anthropic documents shared Pro/Max limits for Claude and Claude Code, including five-hour and weekly allowances. Display them as one provider, not two independent budgets: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan

OpenAI documents that local and cloud Codex work share plan allowance and that additional agentic features can share it. Current plan windows vary; Pro currently has no five-hour limit. This does not establish a single remaining percentage for regular ChatGPT chats: https://learn.chatgpt.com/docs/pricing

Firefox MV3 supports background.scripts event pages; Chrome background service workers are not interchangeable: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background

## Reuse and UI decisions

Reused endpoint/schema knowledge rather than copying large application components. MIT copyright notices and terms are retained. The source is dependency-free at runtime. Build/test dependencies are not shipped in the extension.

The optional split icon uses two broad color blocks (Claude left, Codex right). At 16px there is insufficient room for two readable numeric percentages, so the default icon stays simple and only one badge displays a percentage. The tooltip provides every reported window, including stale labels. The popup uses native progress bars and SVG history, with system/browser color-scheme detection and explicit theme overrides.

Forecasts use net percentage-point change over the selected lookback, including idle time. They require three samples over 15 minutes, a fresh last sample, and a continuous segment with matching account/window/reset. Decreases, long gaps, and reset changes start new segments. This is a conservative net-rate estimate, not a prediction of sliding-window releases or a message counter. Replenishment is never assumed before a successful reading.

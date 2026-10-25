# AI Usage Monitor

A local-first, MIT-licensed Firefox extension for reported subscription usage, toolbar percentages, reset countdowns, conservative forecasts, and history. Built with TypeScript and vanilla DOM; no runtime frameworks, accounts, cloud services, or API keys.

**Support status:** Claude and Codex adapters are implemented and fixture-tested; live-account verification remains necessary. Codex obtains your existing ChatGPT session access token and uses it in memory only to request quota metadata from chatgpt.com. Tokens are never saved, exported, or logged. Regular ChatGPT has no verified overall quota percentage and explicitly displays unavailable.

## Install the finished build

Requires desktop Firefox 142 or later. The packaged build has been installed and smoke-tested in Firefox 158.0 using an isolated profile.

1. Open Firefox and sign into https://claude.ai in your usual, non-container profile session. For Codex, sign into https://chatgpt.com as well.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select `dist/manifest.json` in this project. Keep all files in `dist/` together. Alternatively, select the packaged `artifacts/ai-usage-monitor-1.0.7.zip` from this same temporary-load dialog.
5. Open Firefox's Extensions menu (puzzle icon), find **AI Usage Monitor**, and pin it to the toolbar.
6. Allow the requested website access if Firefox asks. Click the icon to see the dashboard. Use the gear for settings and connection diagnostics.

Temporary add-ons disappear after Firefox restarts. The unsigned ZIP cannot be installed permanently through the ordinary add-ons installer. A permanent installation requires Mozilla signing (see below). No production extension is installed into your normal Firefox profile by the test script.

When connecting for the first time, allow up to 15 seconds per request. If you sign in after an authentication error, use **Refresh** / **Retry connections** after the one-minute manual throttle. Server cooldowns always apply. Claude keeps the last successfully tracked organization if it remains in the membership list. With multiple organizations and no usable previous choice, enter an organization ID in Settings; an explicit selection always takes priority. A private window or a container-only login will not necessarily supply the same session cookies.

## Provider behavior

| Display              | Windows                                                     | Authentication and limitations                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude + Claude Code | Reported five-hour, weekly, and available weekly model caps | Browser-managed Claude cookies. Uses organization discovery plus internal usage endpoint. Missing percentages remain unavailable. Subscription-only; API-key Code usage is outside this pool.                                                                     |
| ChatGPT              | Unavailable                                                 | No verified global subscription quota meter. No speculative requests or fabricated percentages.                                                                                                                                                                   |
| Codex                | Reported primary/secondary windows; duration-based labels   | Uses the existing ChatGPT browser session, obtains an access token in memory from auth/session, and sends it only to the same-origin WHAM usage endpoint. Sign in at chatgpt.com in the normal Firefox profile. Internal endpoints may change or reject sessions. |

See [research](docs/RESEARCH.md) for inspected commits, source paths, licensing, relationships between allowances, upstream fixture results, and official provider references. These undocumented endpoints can change. **No live account quota retrieval has been verified in this environment.**

## Features

- One toolbar badge: Claude, ChatGPT, Codex, or the current quota closest to exhaustion. Remaining or consumed display; green above 50% remaining, yellow 20–50%, red below 20%, gray when no current reading is available.
- Tooltip includes all enabled providers and reported windows. Dual toolbar percentages: large numbers for Claude above Codex, showing the shared Claude/Claude Code weekly allowance on top and Codex’s most constrained current quota below. Enabled on new installation and upgrade to v1.0.5. A dash indicates unavailable data. Turn off the dual-percentage setting to use the original single, larger badge.
- 400px compact popup with two standard quota rows per provider, reset countdowns, connection state, last success, one-line forecasts and an extra-model-cap summary. History graphs, full readings, consumed percentages, sources and diagnostics live in Settings so the popup fits without scrolling. Automatic light/dark color scheme plus overrides.
- Background collection at 1, 5 (default), 10, 15, 30, or 45 minutes; 1, 12, or 24 hours. A one-minute Firefox alarm wakes the scheduler; each provider's persisted eligibility time controls actual network requests. Requests run only when due. Opening the popup does not bypass throttling.
- 15-second per-request timeout, offline detection, explicit 401/403 states, 429 Retry-After, exponentially increasing retry intervals up to six hours, persisted cooldowns, and preserved last-good readings.
- Forecasts from net percentage changes over a 1/3/6/12/24-hour lookback. At least three samples over 15 minutes are required. Idle periods count; resets, decreases, account changes and long gaps split the sample segment. Displays rate per hour, estimated exhaustion and consumption at reset. Forecasts are uncertain, not guaranteed availability or prompt counts.
- SVG graphs for 24 hours / 7 days / 30 days, hover timestamps, CSV export, and history clearing. Retention of 1/7/30 days; older observations downsampled to 15-minute bins. Hard cap: 18,000 observations to limit storage growth (oldest records may be removed before the selected retention period).
- Optional notifications below 50/25/10/5% remaining and on reported replenishment. Off by default; Firefox permission is requested only when enabled. Deduplication survives background restarts and history clearing. If no reset timestamp is supplied, low-threshold alerts are conservatively deduplicated for that window until local extension data is removed.

When a reset time passes, the old quota is not changed to 100%: it becomes stale until the service reports a new reading. A failure in one provider does not prevent another provider from updating. A reported account/organization change clears that provider's previous history. Codex responses without an account ID cannot reliably detect an account switch; this is another limitation of the experimental adapter.

## Build and verify

Node.js 22.19+ and npm are required; the lockfile pins dependencies. Tested with Node 26.8.1. In PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.

```sh
npm ci
npm run check
npm run package
```

- `npm run typecheck` — strict TypeScript checks
- `npm test` — 110 provider, quota, forecasting, history, badge, notification, and background integration tests with mock responses
- `npm run build` — produce self-contained `dist/`
- `npm run lint:extension` — Mozilla Add-ons Linter, warnings treated as errors
- `npm run package` — build and write unsigned distribution ZIP
- `npm run test:firefox` — build/package, install in a fresh headless Firefox profile and exercise real extension APIs/UI
- `npm run package:source` — prepare reviewable source archive, excluding research clones, node_modules and output artifacts

For the Firefox test set `FIREFOX_BINARY` if your executable is not in the standard Windows location. On other platforms Firefox must be discoverable by Selenium. The test downloads Mozilla geckodriver on first run; it needs network access for that download. Provider requests are deliberately blocked through a dead local proxy in the isolated profile. Synthetic fixtures are injected by the test driver only; no sample account data ships in `dist/`. Browser screenshots containing samples are clearly test fixtures. The driver uses its documented `--allow-system-access` option to test extension pages in its disposable profile.

## Signing and publishing

Releases remain unlisted on Mozilla and are distributed through [GitHub releases](https://github.com/demilio5/ai-usage-monitor/releases/latest), with [an HTTPS Firefox update feed](https://demilio5.github.io/ai-usage-monitor/updates.json) hosted on GitHub Pages.

On Windows, configure an existing Mozilla credential in Windows Credential Manager and your GitHub CLI path as described in [the signing guide](docs/SIGNING.md). No signing secret belongs in a file or this repository.

- `npm run release:prepare` validates and builds without signing or publishing.
- Record changes in `CHANGELOG.json` under `unreleased` (Added, Changed, Fixed, Removed). The header version opens the local Version History page built from that same file.
- `package.json` owns the version; build generates the Firefox manifest and bundled history. Never manually version the manifest template.
- When preparing a release, run `npm run version:prepare -- patch` (fixes), `-- minor` (features/improvements), or `-- major` (breaking changes). Review and commit the resulting metadata/changelog. No automatic version bump occurs on edits or commits.
- `npm run release:new -- -ReleaseType minor` remains a combined explicit release command; its default is `patch` and it requires Unreleased notes.
- `npm run release` releases the current version or resumes a pending release without bumping again.

Install the signed update-enabled version once. Subsequent higher versions are delivered through Firefox's updater; the extension retains its existing ID. See [validation](docs/VALIDATION.md) for live-account and OS acceptance checks.

Official guidance: [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) and [Firefox update manifests](https://extensionworkshop.com/documentation/manage/updating-your-extension/).

## Project structure

```text
src/background/      event page, persisted scheduling/backoff, serialized writes
src/providers/       typed, independent Claude / ChatGPT / Codex adapters
src/calculations/    strict percentage validation and observed-rate forecasts
src/storage/         settings validation, bounded history, CSV
src/toolbar/         quota selection, badge, tooltip, optional split icon
src/popup/           compact dashboard
src/options/         preferences, diagnostics, export and clear
src/notifications/   pure alert eligibility and cycle deduplication
src/ui/              DOM helpers and lightweight SVG charts
public/              Firefox MV3 manifest, HTML, original SVG icon
scripts/             build, distribution, source archive, Firefox smoke tests
```

## Privacy and permissions

`storage`: local quota observations and preferences. `alarms`: background scheduling. Host access: `https://claude.ai/*` and `https://chatgpt.com/*` so Firefox can attach its own session cookies to the allowlisted quota GETs. Browsers grant host permissions at origin scope; the network helper independently allowlists only the quota, organization-discovery and session URL patterns. `notifications` and `idle` are optional and off by default. Enable **Reduce refresh while idle** in Settings to request idle permission. After 10 minutes idle or while locked, polling is no more frequent than every 60 minutes; longer configured intervals are preserved. Activity resumes normal scheduling. Manual refresh remains available and server cooldowns always apply. Firefox still wakes its lightweight alarm once a minute; idle mode reduces network requests. Private browsing is disabled for this release.

No cookies permission, credential export, webRequest interception, page scripts, prompt/conversation access, API billing queries, analytics, telemetry, external server, native helper, or remote code. Codex reacquires a session token on each refresh, retains it only in the current request call, and sends it only to the allowlisted chatgpt.com usage endpoint. Redirects are rejected. No session cookies or tokens are saved or exported. Data stays in this Firefox profile; local browser storage is not application-encrypted. CSV contains quota observations without organization IDs. See [security](SECURITY.md) and [privacy](PRIVACY.md).

MIT license. Reference project attributions and MIT terms are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Independent project, not affiliated with Anthropic, OpenAI, or Mozilla.

## Updating a temporary installation

After files are rebuilt, visit about:debugging#/runtime/this-firefox and click Reload beside AI Usage Monitor. Confirm v1.0.7 in the popup footer. Sign in at chatgpt.com in a regular tab and click Refresh. Existing preferences and history remain. If loaded from an older ZIP, remove that temporary add-on and load this project's dist/manifest.json (removal may clear extension data).

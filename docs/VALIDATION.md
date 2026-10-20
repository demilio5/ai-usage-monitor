# Validation and remaining release gates

Validated locally on 2026-10-19:

- TypeScript strict typecheck passes.
- 70 automated tests pass (three suites): provider schemas and failure modes; calculations, resets, forecasts, history, timezones, badge selection, alert deduplication; background persistence, throttling, failures, settings serialization, offline behavior, account switches and server cooldowns across disable/enable.
- Mozilla Add-ons Linter: 0 errors, 0 warnings, 0 notices, with warnings treated as errors.
- Real Firefox 158.0 / geckodriver 0.37.1: temporary MV3 ZIP installation; popup rendering and width; populated three-provider overview measured 553px high including extra-model-cap summaries (under Firefox's 600px popup limit); persisted alarm, gray badge and tooltip; settings round trip, dark theme and canvas split icon; isolated fixture percentages, reset display, forecast and updated toolbar badge; SVG graphs in Settings; history range selection and confirmed history clearing.
- The Firefox browser test uses a new disposable profile and blocks provider service requests. It does not borrow real user authentication. All synthetic observations are injected only through the test driver and never bundled into the extension.
- npm audit reported zero dependency vulnerabilities after replacing the web-ext toolchain with Mozilla Add-ons Linter directly. There are no shipped runtime package dependencies.
- Upstream Tracker's provider JSON/schema fixture tests pass; absent MHTML snapshots were skipped. This does not prove real-account functionality in an upstream extension.

Generated browser results: artifacts/firefox-smoke-results.json. Screenshots: artifacts/firefox-popup-unavailable.png (no account data) and artifacts/firefox-popup-test-fixture.png (synthetic observations). These are browser test artifacts, not live account screenshots.

## Required before claiming a production release

1. Load dist/manifest.json in a normal Firefox profile signed into Claude. Grant the requested host access. Confirm each percentage/reset against claude.ai/settings/usage and verify multi-organization selection if relevant. Check free/flexible plans fail gracefully.
2. Keep Claude closed while consuming the same subscription from Claude Code; wait for an eligible poll and compare the reported pool. API-key Claude Code usage should not be expected in subscription quotas.
3. Test session expiration, logout/login, container-only authentication, host access removal/regrant, offline recovery, and a real quota reset. Old data must remain explicitly stale and must never become an invented 100%.
4. Codex: sign in at chatgpt.com in the normal Firefox profile and compare percentages/reset times against the service dashboard. Session authentication now uses an in-memory token. Verify logout, expired session, account routing, 401/403 and rate limiting. Live-account acceptance remains unverified.
5. ChatGPT: keep the general percentage unavailable unless a verified, legitimate subscription quota endpoint is established. Codex is not its replacement.
6. Observe a quota for at least three polls over 15 minutes, then verify the forecast is reasonably consistent with net reported change. Use multiple days to assess long-window history. Forecasts are estimates and do not model future sliding-window releases.
7. Enable optional Firefox notifications and verify OS notification visibility, each configured threshold, deduplication after event-page/browser restart, and replenishment alerts with actual reported changes. Pure alert and background behavior are tested locally; OS delivery and real cycles remain manual checks.
8. Submit to Mozilla for signing and review before permanent distribution. This build is unsigned and has not been published to AMO or GitHub.

Automated UI tests load the popup document in a Firefox tab for DOM inspection. The installed toolbar's badge/title APIs are exercised, but physical toolbar pinning, popup placement, readability at different display scales, OS notification delivery and very long-lived background behavior still need manual testing.

Version 1.0.1 adds memory-only Codex session authentication, a compact popup with history moved to Settings, extended refresh intervals, and optional idle-aware polling. Automated tests cover token scope/non-persistence, session expiration, token reacquisition, idle throttling/resumption and long intervals. OS idle/lock detection still needs a manual check after enabling its permission.

Idle-aware mode uses a 60-minute minimum network interval after 10 minutes idle or when locked, preserving longer user intervals. Normal polling resumes on activity. Optional idle permission must be enabled in Settings.

Version 1.0.2 adds two crisp numeric toolbar rows: C for Claude above X for Codex. Each uses the most constrained current quota. The overlapping standard badge is hidden in this mode, and unavailable providers use a dash. Independent provider values, used/remaining mode, stale and disabled states are tested.

Version 1.0.3 increases toolbar numeral height from 5 to 7 pixels, removes the tiny provider-letter labels, and uses high-contrast white/dark numerals on solid status-color backgrounds. Claude remains the top row; Codex remains the bottom row. Full window and provider labels remain in the tooltip.

Version 1.0.4 pins the Claude toolbar value to seven_day (shared Claude/Claude Code weekly allowance) in dual-row, single-Claude and automatic badge modes. It never substitutes five_hour or a weekly model-specific sub-cap if the overall weekly quota is absent. An expired five-hour window cannot hide a still-current weekly toolbar reading. Codex selection is unchanged.

Version 1.0.5 shows a local calendar reset date followed by total hours and minutes remaining in each compact popup quota row. Hover exposes the exact date/time/timezone. Missing reset timestamps remain unavailable; expired dates show Awaiting update. Regression tests cover DST, local midnight, year changes, invalid dates and minute rounding.

## Audit implementation verified on 2026-10-20

Baseline commit: `549eaf3`. Each implementation batch has a separate commit:

| Commit    | Change                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e903441` | Preserve Claude cooldown across organization changes; repair sign-in guidance; remove two unused imports and enable compiler unused checks.                           |
| `bf80533` | Serve cached reads without waiting for collection; skip unchanged storage writes while retaining toolbar clock updates and retention cleanup.                         |
| `1a09a45` | Evaluate expired quotas independently; share forecast text; suppress stale forecasts in settings; account for hourly idle samples and explain incompatible lookbacks. |
| `b2ad642` | Validate stored sections, preserve valid records and cooldowns, and test a full 18,000-observation history.                                                           |
| `55ac1d0` | Derive package filenames and UI versions from metadata; reject package/manifest version mismatches before building.                                                   |
| `c1303b8` | Preserve valid manual samples with long automatic intervals and report exhausted allowances without requiring a consumption trend.                                    |

Validation after implementation:

- 93 tests pass across four suites; strict typecheck includes unused locals and parameters.
- Build and Mozilla validation pass with zero errors, warnings, or notices.
- Nine isolated Firefox 158.0 smoke checks pass, including mixed expired/current quotas, stale forecast suppression, reset dates, and popup height/width constraints.
- Formatting, Git whitespace checks, package/source version agreement, archive exclusions, and source inclusion checks pass.
- No dependencies, permissions, CSS, provider endpoints, or UI layouts were changed.
- One initial cached-read batch was rolled back after a Firefox startup readiness check failed. It was reapplied with explicit toolbar readiness; the newly added quota DOM assertions also read an atomic snapshot to avoid stale-element races. Final checks pass.

Remaining limits: daily scheduled polling cannot produce three observations within the maximum 24-hour forecast lookback. This now has an explicit diagnostic; the selected lookback is never silently widened, and sufficient manual samples remain usable. Mutations remain serialized with collection to prevent lost updates; cached reads are independent. Live account authentication, OS idle/lock detection, OS notification delivery, and physical toolbar readability still require the manual acceptance checks above. The rebuilt 1.0.5 package is unsigned; no new Mozilla submission was made during this audit work.

# Privacy policy

AI Usage Monitor keeps settings, current quota readings, short connection diagnostics, alert deduplication, organization selection and bounded quota history in browser.storage.local in your Firefox profile. Nothing is sent to a developer server, analytics platform, cloud database, or another user. The extension never requests passwords or API keys, calls the cookies API, exports cookies, inspects conversations, or stores prompts and responses.

The only service requests are read-only HTTPS GETs to Claude organization/usage endpoints and ChatGPT's auth/session and Codex WHAM usage endpoints on chatgpt.com. Firefox attaches its existing session cookies when it permits those requests. Cookies are sent only to the service to which they belong. Redirects are rejected. Codex reads the existing session access token from auth/session, uses it only in memory to authorize the same-origin WHAM request, and never saves, exports or logs it. No account cookies, tokens or quotas are sent to any third-party server.

History includes provider, quota window, local observation timestamp, reported used percentage, calculated remaining, provider reset timestamp, source label, success status and (internally) the organization/account identifier when available, to keep histories separate. Raw network responses and raw error messages are not retained. Last collection status and sanitized diagnostics are stored separately; failed calls are not observations for forecasting. Data is not synced by the extension.

You may disable providers, change retention, clear history, and export quota observations as CSV in Settings. Clearing history retains current readings, settings and notification deduplication. To erase all extension data use Firefox's extension storage tools or uninstall the extension. No usage history exists until a successful reading. A local storage cap can shorten selected retention periods. Private browsing and container-specific authentication are not supported.

Opening service links deliberately opens those websites, whose own privacy policies apply. CSV exports are local files you choose to create. Notification text can be visible to other people near your screen if enabled. No notifications are enabled by default.

The project is open source under the MIT license; inspect src/providers/http.ts for the network allowlist and src/background/index.ts for local data handling.

If you enable idle-aware refresh, Firefox reports only active, idle or locked state. The extension uses a 10-minute threshold and does not record keystrokes, mouse positions, applications or activity history. Idle state is not saved or exported.

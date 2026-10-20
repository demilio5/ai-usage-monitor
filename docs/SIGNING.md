# Signing handoff — 1.0.2

Prepared packages:

- Extension upload: artifacts/ai-usage-monitor-1.0.2.zip
- Original source upload: artifacts/ai-usage-monitor-source-1.0.2.zip
- Reviewer notes: docs/AMO_REVIEWER_NOTES.md
- Privacy policy: PRIVACY.md

Open https://addons.mozilla.org/developers/ and sign in with your Mozilla account. Use Submit a New Add-on, select On your own (unlisted distribution), and upload the extension ZIP. Upload the source ZIP when asked whether the add-on uses a build step. Build command: npm ci && npm run build. Copy the reviewer notes into the reviewer instructions field when available.

The developer account owner must review and accept Mozilla's developer distribution agreement and other applicable legal terms. No account has been created and no agreement has been accepted by this project.

Only Mozilla can issue the signed XPI; the existing local ZIP is unsigned. After signing is approved, download Mozilla's XPI. In Firefox open about:addons, select the gear menu, choose Install Add-on From File, and select that signed XPI. Firefox will verify the signature during installation. Unlike temporary loading, a signed installation persists through restarts.

Use the same add-on ID for updates; increment the manifest/package version before submitting a new signed build. The current ID is ai-usage-monitor@local.extension. Keep publisher credentials out of source control and chat. No signing API credentials are required for the manual upload path.

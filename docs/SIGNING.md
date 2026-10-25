# Automated unlisted signing and Firefox updates

Releases update `ai-usage-monitor@local.extension`. Public configuration is in `release.config.json`. Source and downloads are at https://github.com/demilio5/ai-usage-monitor. Firefox reads https://demilio5.github.io/ai-usage-monitor/updates.json, served by Pages from `/docs` on the default branch.

## Windows setup

Sign in with GitHub CLI and configure a Git author in this repository. Store the Mozilla JWT issuer and secret as a generic Windows Credential Manager credential. An existing credential from the same Mozilla account can be reused without modifying another add-on or repository.

Create ignored `release.local.json` with nonsecret settings only:

```json
{
  "credentialTarget": "ai-usage-monitor-amo",
  "gitHubCli": "gh"
}
```

`gitHubCli` may be an absolute path. Alternatively pass `-CredentialTarget` and `-GitHubCli` to PowerShell. Never put credential values in this file. The password is trimmed in memory, passed only through `WEB_EXT_API_SECRET` for the signing process alongside `WEB_EXT_API_KEY`, and both variables are removed afterward. No signing credential is written to a file, commit, archive, log, or GitHub secret. Publishing runs after these variables are cleared.

## Release commands

Run from a clean, committed checkout on the default branch:

```powershell
npm run release:prepare # Validate and build only; no credential access or publication.
npm run version:prepare -- minor # Explicitly prepare features/improvements; review and commit these files.
npm run release         # Validate, sign, and publish the reviewed prepared version.
npm run release         # Current version or resume; do not bump a pending release.
```

Use `patch` for fixes, `minor` for features/improvements, and `major` for breaking changes. Preparation moves `CHANGELOG.json` Unreleased notes into a dated entry and synchronizes package/lock metadata; it does not sign, publish, or commit. `npm run release:new -- -ReleaseType minor` remains an explicit combined preparation/signing command (default `patch`), and requires Unreleased notes. Do not edit the manifest template to set a version: build generates it from `package.json`.

The command creates distribution and original source ZIPs, submits an unlisted version with source and reviewer notes to Mozilla API v5, waits up to 15 minutes, and downloads the approved XPI. It checks Mozilla's SHA-256, manifest identity/version/update URL, signature-file presence, and every original package file. Firefox verifies the cryptographic signature during installation. The signing code uses Node built-ins and the existing archive library, with no additional dependency.

The publisher pushes committed source, creates a GitHub release with signed XPI and source ZIP, then commits and pushes `docs/updates.json` with the exact XPI hash. It checks the origin and default branch before pushing. Failed checks, rejected or pending signing, and mismatched packages prevent feed publication. Resume after interruption with `npm run release`: an existing signed version is reused, while a different payload under the same version is refused. Mozilla review can delay signing; API credentials do not bypass review. This is a local command workflow, not a scheduled cloud job holding signing credentials.

## Installation and updates

Install the signed XPI from https://github.com/demilio5/ai-usage-monitor/releases/latest. Existing versions without an update URL need this one-time manual update. Install over the same add-on ID to retain settings and history. Firefox discovers future higher versions from the HTTPS feed. Request an immediate check in `about:addons`, gear, Check for Updates.

Manual AMO upload remains at https://addons.mozilla.org/en-US/developers/addon/64d9e49aecb24c479ea6/versions. Choose unlisted distribution and upload both generated ZIPs. Local settings, usage-history CSV exports, build artifacts, and signed downloads are excluded from Git.

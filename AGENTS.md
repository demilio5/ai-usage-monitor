# Versioning and changelog

- `package.json` is the authoritative current version. Runtime UI reads the generated Firefox manifest; never hardcode a displayed version.
- `public/manifest.json` is a template with no version. Build generates `dist/manifest.json` from package metadata. Do not edit generated output.
- Update `CHANGELOG.json` → `unreleased` for each meaningful change, under Added, Changed, Fixed or Removed. Keep descriptions concise and plain English. This structured changelog is also the source for the local Version History page and published release notes.
- Do not bump a version on routine edits or commits. When preparing a release, run `npm run version:prepare -- patch|minor|major` using one actual level. PATCH fixes; MINOR features/improvements; MAJOR breaking changes. This promotes Unreleased notes, records the preparation date in America/New_York, and synchronizes package/lock metadata. Review the date before publishing if release is delayed.
- Preserve verified historical notes/dates and their provenance. Never invent releases or dates. Releases sort by date descending, then numeric SemVer descending.
- Run focused version tests, then `npm run check` and `npm run test:firefox`. Build must reject metadata/changelog drift. Commit only task files before an authorized release.
- Signing/publication stays in the existing release tools. `npm run release` releases the reviewed prepared version or resumes it. Never prepare another version just to retry signing. Release notice requires fetching public content with a cache-busting query and confirming it.
- Never print or persist signing credentials. Preserve existing credential handling and update-feed identity.

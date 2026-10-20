import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { mozillaClient } from './mozilla-api.mjs';
import { verifySignedXpi } from './release-utils.mjs';

export async function signRelease({
  manifest,
  config,
  archive,
  source,
  notes,
  request,
  fetcher = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeout = 900000,
  log = console.log,
}) {
  if (
    manifest.browser_specific_settings.gecko.id !== config.addonId ||
    manifest.browser_specific_settings.gecko.update_url !== config.updateUrl
  )
    throw new Error('The release identity and HTTPS update URL must match release.config.json.');
  const base = `addons/addon/${encodeURIComponent(config.addonId)}/`;
  const addon = await request(base);
  if (addon.guid !== config.addonId)
    throw new Error('Mozilla returned a different add-on identity.');
  const endpoint = `${base}versions/${manifest.version}/`;
  let version = await request(endpoint, {}, true);
  const deadline = now() + timeout;
  if (!version) {
    const upload = new FormData();
    upload.set('channel', 'unlisted');
    upload.set('upload', new Blob([archive], { type: 'application/zip' }), 'extension.zip');
    let result = await request('addons/upload/', { method: 'POST', body: upload });
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(result.uuid))
      throw new Error('Mozilla returned an invalid upload ID.');
    const uploadPath = `addons/upload/${result.uuid}/`;
    log('Extension uploaded; waiting for Mozilla validation.');
    while (!result.processed) {
      if (now() >= deadline)
        throw new Error('Mozilla validation is pending. Retry the release later without -Bump.');
      await wait(5000);
      result = await request(uploadPath);
    }
    if (!result.valid || result.version !== manifest.version)
      throw new Error(
        'Mozilla validation failed or reported a different version. Check Developer Hub.',
      );
    const submission = new FormData();
    submission.set('upload', result.uuid);
    submission.set('source', new Blob([source], { type: 'application/zip' }), 'source.zip');
    submission.set('license', 'MIT');
    submission.set('approval_notes', notes);
    try {
      version = await request(`${base}versions/`, { method: 'POST', body: submission });
    } catch (error) {
      if (error.status !== 409) throw error;
      version = await request(endpoint);
    }
    log('Unlisted version submitted with source code; waiting for Mozilla signing.');
  }
  while (true) {
    if (
      version.version !== manifest.version ||
      version.channel !== 'unlisted' ||
      version.is_disabled
    )
      throw new Error('Mozilla version identity/channel is unexpected or the version is disabled.');
    if (['disabled', 'rejected'].includes(version.file?.status))
      throw new Error('Mozilla rejected or disabled this version. Check Developer Hub.');
    // is_mozilla_signed_extension marks Mozilla-owned privileged extensions,
    // not ordinary AMO signatures. Approved unlisted files are downloadable.
    if (version.file?.status === 'public') break;
    if (now() >= deadline)
      throw new Error('Mozilla signing is pending. Retry the release later without -Bump.');
    await wait(5000);
    version = await request(endpoint);
  }
  let url = new URL(version.file.url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (
      url.protocol !== 'https:' ||
      !['addons.mozilla.org', 'addons.cdn.mozilla.net'].includes(url.hostname)
    )
      throw new Error('Signed download URL is outside Mozilla HTTPS hosts.');
    // No signing credentials or Authorization header are sent to file downloads.
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = new URL(response.headers.get('location'), url);
      continue;
    }
    if (!response.ok) throw new Error('Signed extension download failed.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    verifySignedXpi(bytes, archive, manifest, version.file.hash);
    return bytes;
  }
  throw new Error('Too many signed download redirects.');
}

async function main() {
  const issuer = process.env.WEB_EXT_API_KEY?.trim(),
    secret = process.env.WEB_EXT_API_SECRET?.trim();
  delete process.env.WEB_EXT_API_KEY;
  delete process.env.WEB_EXT_API_SECRET;
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  const config = JSON.parse(await readFile('release.config.json', 'utf8'));
  const bytes = await signRelease({
    manifest,
    config,
    archive: await readFile(`artifacts/ai-usage-monitor-${manifest.version}.zip`),
    source: await readFile(`artifacts/ai-usage-monitor-source-${manifest.version}.zip`),
    notes: await readFile('docs/AMO_REVIEWER_NOTES.md', 'utf8'),
    request: mozillaClient({ issuer, secret }),
  });
  await mkdir('artifacts', { recursive: true });
  const output = `artifacts/ai-usage-monitor-${manifest.version}.xpi`;
  await writeFile(output, bytes);
  console.log(`Verified Mozilla-signed extension saved: ${output}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    const message = String(error.message);
    console.error(
      /^(Mozilla|The release|Signed |Downloaded |Too many)/.test(message)
        ? message
        : 'Mozilla signing could not complete.',
    );
    console.error('No feed was published. Check Developer Hub, then retry without -Bump.');
    process.exitCode = 1;
  });

import { expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { createJwt, mozillaClient, mozillaSignedDownload } from '../scripts/mozilla-api.mjs';
import { signRelease } from '../scripts/sign-mozilla.mjs';
import { verifySignedXpi, updateFeed } from '../scripts/release-utils.mjs';

const manifest = {
  version: '1.0.7',
  browser_specific_settings: {
    gecko: {
      id: 'monitor-fixture@local',
      strict_min_version: '142.0',
      update_url: 'https://example.test/updates.json',
    },
  },
};
const config = {
  addonId: manifest.browser_specific_settings.gecko.id,
  updateUrl: manifest.browser_specific_settings.gecko.update_url,
};
const files = {
  'manifest.json': strToU8(JSON.stringify(manifest)),
  'background.js': strToU8('/* release fixture */'),
};
const archive = zipSync(files);
const signed = zipSync({ ...files, 'META-INF/mozilla.rsa': strToU8('SIGNATURE FIXTURE ONLY') });
const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const approved = {
  version: manifest.version,
  channel: 'unlisted',
  is_disabled: false,
  file: {
    id: 123,
    status: 'public',
    is_mozilla_signed_extension: false,
    url: 'https://addons.mozilla.org/file/fixture.xpi',
    hash: hash(signed),
  },
};
function signingOptions(versions = [approved]) {
  const request = vi.fn().mockResolvedValueOnce({ guid: config.addonId });
  for (const version of versions) request.mockResolvedValueOnce(version);
  return {
    manifest,
    config,
    archive,
    source: strToU8('SOURCE FIXTURE'),
    notes: 'Reviewer fixture',
    request,
    fetcher: vi.fn(async () => new Response(signed)),
    log: vi.fn(),
  };
}
it('creates fresh one-minute HS256 JWTs without exposing the secret', () => {
  const first = createJwt('fixture-issuer', 'fixture-secret', 1000);
  const [header, payload, signature] = first.split('.');
  expect(JSON.parse(Buffer.from(header, 'base64url'))).toEqual({ alg: 'HS256', typ: 'JWT' });
  expect(JSON.parse(Buffer.from(payload, 'base64url'))).toMatchObject({
    iss: 'fixture-issuer',
    iat: 1000,
    exp: 1060,
  });
  expect(signature).toBe(
    createHmac('sha256', 'fixture-secret').update(`${header}.${payload}`).digest('base64url'),
  );
  expect(first).not.toContain('fixture-secret');
  expect(createJwt('fixture-issuer', 'fixture-secret', 1000)).not.toBe(first);
});
it('restricts authenticated requests to Mozilla and prevents redirect credential forwarding', async () => {
  const fetcher = vi.fn(async () => new Response('{}'));
  const request = mozillaClient({ issuer: 'fixture', secret: 'fixture-secret', fetcher });
  for (const path of [
    'https://example.test/api/v5/',
    '//example.test/api/v5/',
    'http://addons.mozilla.org/api/v5/',
    'https://addons.mozilla.org/api/v4/',
  ])
    await expect(request(path)).rejects.toThrow('only be sent');
  expect(fetcher).not.toHaveBeenCalled();
  await request('addons/upload/');
  expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  expect(fetcher.mock.calls[0][1].headers.Authorization).toMatch(/^JWT /);
});
it('sanitizes server and network errors rather than logging credentials or raw responses', async () => {
  for (const fetcher of [
    vi.fn(async () => new Response('fixture-secret', { status: 403 })),
    vi.fn(async () => {
      throw new Error('fixture-secret');
    }),
  ]) {
    const request = mozillaClient({ issuer: 'fixture', secret: 'fixture-secret', fetcher });
    await expect(request('addons/upload/')).rejects.not.toThrow('fixture-secret');
  }
});
it('resumes an approved ordinary unlisted version without uploading it twice', async () => {
  const options = signingOptions();
  expect(await signRelease(options)).toEqual(signed);
  expect(options.request).toHaveBeenCalledTimes(2);
  expect(options.fetcher.mock.calls[0][1].headers).toBeUndefined();
});
it('keeps reviewer notes within the Mozilla limit and rejects oversized notes before requests', async () => {
  const notes = await readFile(new URL('../docs/AMO_REVIEWER_NOTES.md', import.meta.url), 'utf8');
  expect(notes.length).toBeLessThanOrEqual(3000);
  const options = { ...signingOptions(), notes: 'x'.repeat(3001) };
  await expect(signRelease(options)).rejects.toThrow('3000-character');
  expect(options.request).not.toHaveBeenCalled();
});
it.each(['00000000-0000-4000-8000-000000000001', '00000000000040008000000000000001'])(
  'uploads sources and verifies signing with either Mozilla UUID format: %s',
  async (uuid) => {
    const options = signingOptions([
      null,
      { uuid, processed: false },
      { uuid, processed: true, valid: true, version: manifest.version },
      { ...approved, file: { status: 'awaiting_review' } },
      approved,
    ]);
    options.wait = vi.fn(async () => {});
    expect(await signRelease(options)).toEqual(signed);
    const upload = options.request.mock.calls[2][1].body;
    expect(upload.get('channel')).toBe('unlisted');
    const submission = options.request.mock.calls[4][1].body;
    expect(submission.get('upload')).toBe(uuid);
    expect(await submission.get('source').text()).toBe('SOURCE FIXTURE');
    expect(submission.get('approval_notes')).toBe('Reviewer fixture');
    expect(options.wait).toHaveBeenCalledTimes(2);
  },
);
it('stops when Mozilla rejects validation without creating a version or downloading', async () => {
  const options = signingOptions([
    null,
    { uuid: '00000000-0000-4000-8000-000000000001', processed: true, valid: false },
  ]);
  await expect(signRelease(options)).rejects.toThrow('validation failed');
  expect(options.request).toHaveBeenCalledTimes(3);
  expect(options.fetcher).not.toHaveBeenCalled();
});
it('stops on review timeout and leaves the version available for a later resume', async () => {
  const options = signingOptions([{ ...approved, file: { status: 'awaiting_review' } }]);
  options.now = () => 1000;
  options.timeout = 0;
  await expect(signRelease(options)).rejects.toThrow('pending');
  expect(options.fetcher).not.toHaveBeenCalled();
});
it.each([
  { ...approved, channel: 'listed' },
  { ...approved, is_disabled: true },
  { ...approved, file: { status: 'rejected' } },
])('rejects the wrong distribution channel or disabled/rejected versions', async (version) => {
  await expect(signRelease(signingOptions([version]))).rejects.toThrow();
});
it('does not follow a signed-file redirect outside Mozilla hosts', async () => {
  const options = signingOptions();
  options.fetcher = vi.fn(
    async () =>
      new Response(null, { status: 302, headers: { location: 'https://example.test/file.xpi' } }),
  );
  await expect(signRelease(options)).rejects.toThrow('outside Mozilla');
  expect(options.fetcher).toHaveBeenCalledTimes(1);
});
it('downloads unlisted files with scoped API authentication and drops it on CDN redirects', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://addons.cdn.mozilla.net/fixture.xpi' },
      }),
  );
  const download = mozillaSignedDownload({ issuer: 'fixture', secret: 'fixture-secret', fetcher });
  const options = { ...signingOptions(), authenticatedDownload: download };
  expect(await signRelease(options)).toEqual(signed);
  expect(fetcher.mock.calls[0][0]).toBe('https://addons.mozilla.org/api/v4/file/123/');
  expect(fetcher.mock.calls[0][1].headers.Authorization).toMatch(/^JWT /);
  expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
  expect(options.fetcher.mock.calls[0][1].headers).toBeUndefined();
  await expect(download('../other')).rejects.toThrow('invalid signed-file');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects tampered hashes, changed payloads, unsigned packages, and the wrong extension identity', () => {
  expect(() => verifySignedXpi(signed, archive, manifest, hash(signed))).not.toThrow();
  expect(() => verifySignedXpi(signed, archive, manifest, 'sha256:' + '0'.repeat(64))).toThrow(
    'hash',
  );
  const changed = zipSync({
    ...files,
    'background.js': strToU8('changed'),
    'META-INF/mozilla.rsa': strToU8('fixture'),
  });
  expect(() => verifySignedXpi(changed, archive, manifest, hash(changed))).toThrow('differs');
  expect(() => verifySignedXpi(archive, archive, manifest, hash(archive))).toThrow('signature');
  expect(() =>
    verifySignedXpi(signed, archive, { ...manifest, version: '9.0.0' }, hash(signed)),
  ).toThrow('identity');
});
it('generates an HTTPS update feed tied to the exact add-on ID, artifact hash, and Firefox compatibility', () => {
  const feed = updateFeed(manifest, 'fixture/monitor', 'a'.repeat(64));
  expect(feed.addons[config.addonId].updates[0]).toEqual({
    version: '1.0.7',
    update_link:
      'https://github.com/fixture/monitor/releases/download/v1.0.7/ai-usage-monitor-1.0.7.xpi',
    update_hash: 'sha256:' + 'a'.repeat(64),
    applications: { gecko: { strict_min_version: '142.0' } },
  });
  expect(() => updateFeed(manifest, 'invalid repo', 'a'.repeat(64))).toThrow();
});

it('allows Mozilla manifest whitespace normalization but rejects changed manifest values', () => {
  const normalized = zipSync({
    ...files,
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'META-INF/mozilla.rsa': strToU8('SIGNATURE FIXTURE ONLY'),
  });
  expect(() => verifySignedXpi(normalized, archive, manifest, hash(normalized))).not.toThrow();
  const changed = zipSync({
    ...files,
    'manifest.json': strToU8(JSON.stringify({ ...manifest, permissions: ['tabs'] })),
    'META-INF/mozilla.rsa': strToU8('SIGNATURE FIXTURE ONLY'),
  });
  expect(() => verifySignedXpi(changed, archive, manifest, hash(changed))).toThrow('manifest.json');
});

it('reports actionable Mozilla field errors with credentials redacted', async () => {
  const request = mozillaClient({
    issuer: 'fixture-issuer',
    secret: 'fixture-secret',
    fetcher: async () =>
      new Response(
        JSON.stringify({
          source: ['Bad archive fixture-secret'],
          license: ['fixture-issuer is invalid'],
        }),
        { status: 400 },
      ),
  });
  await expect(request('addons/upload/')).rejects.toThrow('source');
  await expect(request('addons/upload/')).rejects.not.toThrow('fixture-secret');
  await expect(request('addons/upload/')).rejects.not.toThrow('fixture-issuer');
});

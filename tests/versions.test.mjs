import { it, expect } from 'vitest';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  versionHistory,
  nextVersion,
  prepareRelease,
  releaseNotes,
} from '../scripts/changelog.mjs';
const history = {
  unreleased: { Added: ['A useful new feature.'] },
  releases: [
    { version: '1.0.9', date: '2026-10-22', changes: { Fixed: ['An earlier fix.'] } },
    { version: '1.0.10', date: '2026-10-22', changes: { Changed: ['A later correction.'] } },
  ],
};
it('prepares CLI metadata and changelog together without changing unrelated package fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-usage-version-'));
  try {
    const changes = structuredClone(history);
    changes.releases.forEach((release) => {
      release.date = '2000-01-01';
    });
    const pkg = { name: 'fixture', version: '1.0.10', scripts: { test: 'kept' } };
    const lock = { version: pkg.version, packages: { '': { version: pkg.version } } };
    await Promise.all(
      [
        ['package.json', pkg],
        ['package-lock.json', lock],
        ['CHANGELOG.json', changes],
      ].map(([path, data]) => writeFile(join(directory, path), JSON.stringify(data))),
    );
    execFileSync(process.execPath, [resolve('scripts/prepare-version.mjs'), 'minor'], {
      cwd: directory,
      windowsHide: true,
    });
    const [updated, updatedLock, updatedHistory] = await Promise.all(
      ['package.json', 'package-lock.json', 'CHANGELOG.json'].map(async (path) =>
        JSON.parse(await readFile(join(directory, path), 'utf8')),
      ),
    );
    expect(updated.version).toBe('1.1.0');
    expect(updated.scripts).toEqual(pkg.scripts);
    expect(updatedLock.packages[''].version).toBe(updated.version);
    expect(versionHistory(updatedHistory, updated.version).releases[0].version).toBe(
      updated.version,
    );
    expect(updatedHistory.unreleased).toEqual({});
  } finally {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('ai-usage-version-')
    )
      throw new Error('Unexpected temporary test directory');
    await rm(directory, { recursive: true, force: true });
  }
});
it('sorts dates newest first and uses numeric SemVer when dates match', () => {
  expect(versionHistory(history, '1.0.10').releases.map((r) => r.version)).toEqual([
    '1.0.10',
    '1.0.9',
  ]);
  const dated = structuredClone(history);
  dated.releases[0].date = '2026-10-21';
  expect(versionHistory(dated, '1.0.10').releases[0].version).toBe('1.0.10');
});
it('rejects version drift, duplicate versions, malformed dates and missing descriptions', () => {
  expect(() => versionHistory(history, '1.0.8')).toThrow('match');
  for (const change of [
    (h) => h.releases.push(h.releases[0]),
    (h) => (h.releases[0].date = '2026-02-30'),
    (h) => (h.releases[0].changes = { Fixed: [''] }),
    (h) => (h.releases[0].version = '1.02.3'),
  ]) {
    const h = structuredClone(history);
    change(h);
    expect(() => versionHistory(h, '1.0.10')).toThrow();
  }
});
it('prepares explicit release levels, moves Unreleased notes and resets lower components', () => {
  expect(nextVersion('1.2.9', 'patch')).toBe('1.2.10');
  expect(nextVersion('1.2.9', 'minor')).toBe('1.3.0');
  expect(nextVersion('1.2.9', 'major')).toBe('2.0.0');
  expect(() => nextVersion('1.2.9', undefined)).toThrow();
  const prepared = prepareRelease(history, '1.0.10', 'minor', '2026-10-25');
  expect(prepared.version).toBe('1.1.0');
  expect(prepared.history.unreleased).toEqual({});
  expect(prepared.history.releases[0].changes).toEqual(history.unreleased);
  expect(history.unreleased.Added).toHaveLength(1);
  expect(() =>
    prepareRelease({ ...history, unreleased: {} }, '1.0.10', 'patch', '2026-10-25'),
  ).toThrow('Unreleased');
});
it('builds release notes from the same grouped entry used by Version History', () => {
  expect(releaseNotes(history.releases[1])).toContain('### Changed\n\n- A later correction.');
});
it('keeps package metadata and the latest released history synchronized, with no template version', async () => {
  const [pkg, lock, manifest, changelog] = await Promise.all(
    ['package.json', 'package-lock.json', 'public/manifest.json', 'CHANGELOG.json'].map(async (p) =>
      JSON.parse(await readFile(p, 'utf8')),
    ),
  );
  expect(versionHistory(changelog, pkg.version).releases[0].version).toBe(pkg.version);
  expect(lock.version).toBe(pkg.version);
  expect(lock.packages[''].version).toBe(pkg.version);
  expect(manifest.version).toBeUndefined();
});

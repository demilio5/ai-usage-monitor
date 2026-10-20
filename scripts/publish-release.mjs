import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { updateFeed, verifySignedXpi } from './release-utils.mjs';

const gh = process.env.AI_USAGE_GH_PATH || 'gh';
function command(exe, args, allowFailure = false) {
  const result = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true });
  if ((result.error || result.status !== 0) && !allowFailure)
    throw new Error(`${exe === gh ? 'GitHub' : 'Git'} operation failed; publication stopped.`);
  return result;
}
const git = (...args) => command('git', args).stdout.trim();
const api = (...args) => command(gh, args);

try {
  // Publishing never inherits the Mozilla credential, even with direct CLI use.
  delete process.env.WEB_EXT_API_KEY;
  delete process.env.WEB_EXT_API_SECRET;
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  const config = JSON.parse(await readFile('release.config.json', 'utf8'));
  const { repository, addonId, updateUrl } = config;
  if (
    manifest.browser_specific_settings.gecko.id !== addonId ||
    manifest.browser_specific_settings.gecko.update_url !== updateUrl
  )
    throw new Error('Release configuration does not match the extension.');
  const version = manifest.version,
    tag = `v${version}`;
  const filename = `ai-usage-monitor-${version}.xpi`,
    xpi = `artifacts/${filename}`;
  const bytes = await readFile(xpi),
    hash = createHash('sha256').update(bytes).digest('hex');
  verifySignedXpi(
    bytes,
    await readFile(`artifacts/ai-usage-monitor-${version}.zip`),
    manifest,
    `sha256:${hash}`,
  );
  const branch = git('branch', '--show-current');
  const remoteBranch = JSON.parse(
    api('repo', 'view', repository, '--json', 'defaultBranchRef').stdout,
  ).defaultBranchRef?.name;
  if (!branch || branch !== remoteBranch)
    throw new Error('Release only from the repository default branch.');
  if (git('status', '--porcelain')) throw new Error('Commit source changes before publishing.');
  const origin = git('remote', 'get-url', 'origin');
  if (
    ![
      `https://github.com/${repository}.git`,
      `https://github.com/${repository}`,
      `git@github.com:${repository}.git`,
    ].includes(origin)
  )
    throw new Error('Origin must point to the AI Usage Monitor release repository.');
  command('git', ['push', 'origin', branch]);
  const existing = command(
    gh,
    ['release', 'view', tag, '--repo', repository, '--json', 'url'],
    true,
  );
  if (existing.status === 0) {
    const verification = `artifacts/verify-${version}`;
    await mkdir(verification, { recursive: true });
    api(
      'release',
      'download',
      tag,
      '--repo',
      repository,
      '--pattern',
      filename,
      '--dir',
      verification,
      '--clobber',
    );
    const published = await readFile(`${verification}/${filename}`);
    if (!bytes.equals(published))
      throw new Error('An existing GitHub release contains a different XPI; bump the version.');
  } else {
    const notes = `AI Usage Monitor ${version}. Signed by Mozilla for unlisted distribution. Includes Claude organization recovery and automatic Firefox updates.\n`;
    await writeFile('artifacts/release-notes.md', notes);
    api(
      'release',
      'create',
      tag,
      xpi,
      `artifacts/ai-usage-monitor-source-${version}.zip`,
      '--repo',
      repository,
      '--target',
      git('rev-parse', 'HEAD'),
      '--title',
      `AI Usage Monitor ${version}`,
      '--notes-file',
      'artifacts/release-notes.md',
    );
  }
  await writeFile(
    'docs/updates.json',
    JSON.stringify(updateFeed(manifest, repository, hash), null, 2) + '\n',
  );
  command('git', ['add', 'docs/updates.json']);
  if (command('git', ['diff', '--cached', '--quiet'], true).status !== 0)
    command('git', ['commit', '-m', `release: publish Firefox update feed for ${version}`]);
  command('git', ['push', 'origin', branch]);
  console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);
  console.log(`Firefox update feed: ${updateUrl}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

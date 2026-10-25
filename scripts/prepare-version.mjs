import { readFile, writeFile } from 'node:fs/promises';
import { prepareRelease } from './changelog.mjs';
const files = ['package.json', 'package-lock.json', 'CHANGELOG.json'];
const [pkg, lock, history] = await Promise.all(
  files.map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
);
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version)
  throw new Error('Package lock and package version differ.');
const date = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'America/New_York',
}).format(new Date());
const next = prepareRelease(history, pkg.version, process.argv[2], date);
pkg.version = lock.version = lock.packages[''].version = next.version;
await Promise.all(
  [pkg, lock, next.history].map((data, index) =>
    writeFile(files[index], JSON.stringify(data, null, 2) + '\n'),
  ),
);
console.log(
  `Prepared ${next.version}. Review and commit metadata and changelog before release. Nothing was signed or published.`,
);

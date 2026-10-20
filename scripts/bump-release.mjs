import { readFile, writeFile } from 'node:fs/promises';
const files = ['package.json', 'package-lock.json', 'public/manifest.json'];
const [pkg, lock, manifest] = await Promise.all(
  files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
);
if (
  !/^\d+\.\d+\.\d+$/.test(pkg.version) ||
  pkg.version !== manifest.version ||
  lock.version !== pkg.version
)
  throw new Error('Release versions must agree before bumping.');
const parts = pkg.version.split('.').map(Number);
parts[2]++;
const version = parts.join('.');
pkg.version = lock.version = lock.packages[''].version = manifest.version = version;
await Promise.all(
  [pkg, lock, manifest].map((value, index) =>
    writeFile(files[index], JSON.stringify(value, null, 2) + '\n'),
  ),
);
console.log(`Prepared version ${version}`);

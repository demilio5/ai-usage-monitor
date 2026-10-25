import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { versionHistory } from './changelog.mjs';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
if ('version' in manifest)
  throw new Error('The manifest is a template; keep the version only in package.json.');
const history = versionHistory(JSON.parse(await readFile('CHANGELOG.json', 'utf8')), pkg.version);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version)
  throw new Error('Package lock version must match package.json; use version:prepare.');
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await writeFile(
  'dist/manifest.json',
  JSON.stringify({ ...manifest, version: pkg.version }, null, 2) + '\n',
);
await writeFile('dist/version-history.json', JSON.stringify(history, null, 2) + '\n');
await build({
  entryPoints: {
    background: 'src/background/index.ts',
    popup: 'src/popup/index.ts',
    options: 'src/options/index.ts',
    history: 'src/version-history/index.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'firefox142',
  sourcemap: false,
  legalComments: 'eof',
});
await cp('src/ui.css', 'dist/ui.css');
await cp('THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.md');
await cp('LICENSE', 'dist/LICENSE');
console.log('Firefox extension built in dist/');

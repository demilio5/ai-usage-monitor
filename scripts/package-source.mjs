import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
const files = {};
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const include = ['src', 'public', 'scripts', 'tests', 'tools', 'docs', '.github'];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.env') || e.name.endsWith('.local.json')) continue;
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) await walk(path);
    else files[path] = new Uint8Array(await readFile(path));
  }
}
for (const dir of include) await walk(dir);
for (const name of [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  '.prettierrc.json',
  'README.md',
  'CHANGELOG.json',
  'AGENTS.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'PRIVACY.md',
  'SECURITY.md',
  '.gitignore',
  'release.config.json',
])
  files[name] = new Uint8Array(await readFile(name));
await mkdir('artifacts', { recursive: true });
const output = `artifacts/ai-usage-monitor-source-${version}.zip`;
await writeFile(output, zipSync(files));
console.log(`Reviewable source archived in ${output}`);

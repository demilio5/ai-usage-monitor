import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
const files = {};
const include = ['src', 'public', 'scripts', 'tests', 'docs', '.github'];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
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
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'PRIVACY.md',
  'SECURITY.md',
  '.gitignore',
])
  files[name] = new Uint8Array(await readFile(name));
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/ai-usage-monitor-source-1.0.5.zip', zipSync(files));
console.log('Reviewable source archived in artifacts/ai-usage-monitor-source-1.0.5.zip');

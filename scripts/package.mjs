import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
const files = {};
const { version } = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
async function walk(dir, prefix = '') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const key = prefix + e.name;
    if (e.isDirectory()) await walk(`${dir}/${e.name}`, `${key}/`);
    else files[key] = new Uint8Array(await readFile(`${dir}/${e.name}`));
  }
}
await walk('dist');
await mkdir('artifacts', { recursive: true });
const output = `artifacts/ai-usage-monitor-${version}.zip`;
await writeFile(output, zipSync(files));
console.log(`Packaged ${output} (unsigned)`);

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({
  entryPoints: {
    background: 'src/background/index.ts',
    popup: 'src/popup/index.ts',
    options: 'src/options/index.ts',
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

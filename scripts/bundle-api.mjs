import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('api', { recursive: true });

await build({
  entryPoints: ['server/vercel.ts'],
  outfile: 'api/[[...path]].mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  legalComments: 'none',
});

import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';

await bundle({
  entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'],
});
await bundle({
  entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'],
});
await viteBuild();

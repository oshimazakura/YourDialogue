import { build } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

await build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs', bundle: true,
  platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: true });
await build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs', bundle: true,
  platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: true });
const server = await createServer();
await server.listen();
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
const close = async () => { child.kill(); await server.close(); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });

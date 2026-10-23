import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostics } from '../core/diagnostics.ts';

export interface DebugOptions {
  directory: string;
  diagnostics: Diagnostics;
  state: () => unknown;
  characters?: (content: boolean) => unknown;
  screenshot?: () => Promise<Buffer>;
}

export function createDebugHandler(
  options: DebugOptions,
  token: string,
  port: number,
  startedAt = new Date().toISOString(),
) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body, null, 2));
    };
    // Reject browser-origin requests and DNS rebinding hostnames; no CORS support.
    if (request.headers.origin || request.headers.host !== `127.0.0.1:${port}`) {
      json(403, { error: 'Forbidden' });
      return;
    }
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      json(401, { error: 'Unauthorized' });
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      json(405, { error: 'Read-only API' });
      return;
    }
    let pathname = '';
    try {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      pathname = url.pathname;
      if (url.pathname === '/debug/state') {
        json(200, {
          schemaVersion: 1,
          pid: process.pid,
          startedAt,
          contentLogging: options.diagnostics.includeContent,
          ...(options.diagnostics.sanitize(options.state()) as object),
          renderer: options.diagnostics.renderer(),
          log: { diskError: options.diagnostics.diskError },
        });
      } else if (url.pathname === '/debug/characters' && options.characters) {
        const content = url.searchParams.get('content') ?? '0';
        if (!['0', '1'].includes(content)) {
          json(400, { error: 'content must be 0 or 1' });
          return;
        }
        json(
          200,
          options.diagnostics.sanitize(
            {
              schemaVersion: 1,
              pid: process.pid,
              capturedAt: new Date().toISOString(),
              ...(options.characters(content === '1') as object),
            },
            content === '1' ? 100000 : 4000,
          ),
        );
      } else if (url.pathname === '/debug/events') {
        const since = Number(url.searchParams.get('since') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 100);
        if (
          !Number.isSafeInteger(since) ||
          since < 0 ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 500
        ) {
          json(400, { error: 'since must be >= 0; limit must be 1..500' });
          return;
        }
        json(200, options.diagnostics.events(since, limit));
      } else if (url.pathname === '/debug/screenshot' && options.screenshot) {
        const png = await options.screenshot();
        options.diagnostics.record('screenshot.captured');
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.end(png);
      } else json(404, { error: 'Not found' });
    } catch {
      options.diagnostics.record('debug.request_failed', { path: pathname }, 'error');
      json(503, { error: 'Diagnostic data unavailable' });
    }
  };
}

export async function startDebugServer(options: DebugOptions) {
  const token = randomBytes(32).toString('hex');
  const startedAt = new Date().toISOString();
  let port = 0;
  const server = createServer((request, response) => {
    void createDebugHandler(options, token, port, startedAt)(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('診断APIを起動できません。');
  port = address.port;
  const url = `http://127.0.0.1:${port}`;
  try {
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(options.directory, 'token'), token, { mode: 0o600 });
    chmodSync(join(options.directory, 'token'), 0o600);
    writeFileSync(
      join(options.directory, 'connection.json'),
      JSON.stringify({ url, pid: process.pid, startedAt }, null, 2),
      { mode: 0o600 },
    );
    chmodSync(join(options.directory, 'connection.json'), 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  options.diagnostics.record('debug.started', { url, pid: process.pid });
  return {
    url,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      rmSync(join(options.directory, 'token'), { force: true });
      rmSync(join(options.directory, 'connection.json'), { force: true });
    },
  };
}

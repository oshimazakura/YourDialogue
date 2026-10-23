import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Diagnostics } from '../src/core/diagnostics.ts';
import { JsonlDecoder } from '../src/core/jsonl.ts';
import { defaultCharacter } from '../src/shared/character.ts';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createDebugHandler, startDebugServer } from '../src/main/debug-server.ts';
import { DialogueService } from '../src/core/service.ts';
import { Store } from '../src/core/store.ts';

function temp() {
  return mkdtempSync(join(tmpdir(), 'dialogue-debug-'));
}

test('JSONL diagnostics distinguish syntax, schema, expression fallback and partial discard', () => {
  const log = new Diagnostics();
  const decoder = new JsonlDecoder(
    defaultCharacter,
    () => {},
    () => {},
    { record: log.record },
  );
  decoder.push('{"type":"speech","text":"private conversation"\n');
  decoder.push('{"type":"phone","format":"html","text":"private conversation"}\n');
  decoder.push('{"type":"speech","expression":"missing","text":"private conversation"}\n');
  decoder.push('{"type":"speech","text":"unfinished private conversation');
  assert.equal(decoder.snapshot().pendingCharacters > 0, true);
  decoder.discard();
  assert.equal(decoder.snapshot().pendingCharacters, 0);
  const events = log.events().events;
  assert.equal(events.filter((item) => item.event === 'jsonl.invalid').length, 2);
  assert.equal(events[0].data.reason, 'invalid_json');
  assert.equal(events[1].data.reason, 'unsupported_phone_format');
  assert.ok(events.some((item) => item.event === 'jsonl.expression_fallback'));
  assert.ok(events.some((item) => item.event === 'jsonl.partial_discarded'));
  assert.doesNotMatch(JSON.stringify(events), /private conversation/);
});

test('content logging is explicit and redacts known secrets from raw parse previews', () => {
  const log = new Diagnostics(undefined, true);
  log.addSecret('test-secret-value');
  const decoder = new JsonlDecoder(
    defaultCharacter,
    () => {},
    () => {},
    { record: log.record, includeContent: log.includeContent },
  );
  decoder.push('{"text":"hello test-secret-value"\n');
  const output = JSON.stringify(log.events());
  assert.match(output, /hello/);
  assert.doesNotMatch(output, /test-secret-value/);
  log.record('nested', { apiKey: 'another-secret', child: { authorization: 'Bearer credential' } });
  assert.doesNotMatch(JSON.stringify(log.events()), /another-secret|credential/);
});

test('events are bounded, persisted, filterable and rotated on restart', () => {
  const directory = temp();
  try {
    const log = new Diagnostics(directory);
    for (let i = 0; i < 510; i++) log.record('test', { count: i });
    assert.equal(log.events(0, 500).events.length, 500);
    assert.deepEqual(
      log.events(509).events.map((item) => item.id),
      [510],
    );
    assert.equal(statSync(join(directory, 'events.jsonl')).mode & 0o777, 0o600);
    assert.match(readFileSync(join(directory, 'events.jsonl'), 'utf8'), /"count":509/);
    const next = new Diagnostics(directory);
    next.record('restarted');
    assert.match(readFileSync(join(directory, 'events.jsonl.previous'), 'utf8'), /"count":509/);
    assert.doesNotMatch(readFileSync(join(directory, 'events.jsonl'), 'utf8'), /"count":509/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('renderer state retains snapshots, avoids per-character log spam and validates payloads', () => {
  const log = new Diagnostics();
  log.updateUi({
    source: 'dialogue',
    messageId: 'm',
    phase: 'typing',
    page: 1,
    visibleCharacters: 1,
  });
  log.updateUi({
    source: 'dialogue',
    messageId: 'm',
    phase: 'typing',
    page: 1,
    visibleCharacters: 2,
  });
  assert.equal(log.events().events.length, 1);
  assert.equal((log.renderer().dialogue as Record<string, unknown>).visibleCharacters, 2);
  log.updateUi({
    source: 'app',
    sessionId: 's',
    panel: 'phone',
    apiKey: 'do not retain',
    text: 'do not retain',
  });
  assert.doesNotMatch(JSON.stringify(log.renderer()), /do not retain/);
  log.updateUi({ source: 'dialogue', phase: { unexpected: true } });
  assert.equal((log.renderer().dialogue as Record<string, unknown>).phase, 'typing');
  log.clearUi();
  assert.equal(log.renderer().lastReportedAt, null);
});

test('diagnostic HTTP API is authenticated, read-only, local and has an explicit screenshot endpoint', async (t) => {
  const directory = temp();
  const log = new Diagnostics(directory);
  const png = Buffer.from('test-png');
  let server: Awaited<ReturnType<typeof startDebugServer>>;
  try {
    server = await startDebugServer({
      directory,
      diagnostics: log,
      state: () => ({ summary: 'waiting_for_page_advance', apiKey: 'never return this' }),
      screenshot: async () => png,
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip(
        'この実行環境はlocalhostの待ち受けを禁止しています。HTTPハンドラ自体は別テストで検証します。',
      );
      return;
    }
    throw error;
  }
  const token = readFileSync(join(directory, 'token'), 'utf8');
  const headers = { Authorization: `Bearer ${token}` };
  try {
    assert.equal(statSync(join(directory, 'token')).mode & 0o777, 0o600);
    assert.equal((await fetch(server.url + '/debug/state')).status, 401);
    assert.equal(
      (
        await fetch(server.url + '/debug/state', {
          headers: { ...headers, Origin: 'http://example.org' },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(server.url + '/debug/state', { method: 'POST', headers })).status,
      405,
    );
    const state = await (await fetch(server.url + '/debug/state', { headers })).json();
    assert.equal(state.summary, 'waiting_for_page_advance');
    assert.equal(state.apiKey, '[REDACTED]');
    const events = await (
      await fetch(server.url + '/debug/events?since=0&limit=1', { headers })
    ).json();
    assert.equal(events.events.length, 1);
    assert.equal((await fetch(server.url + '/debug/events?since=NaN', { headers })).status, 400);
    assert.equal((await fetch(server.url + '/other', { headers })).status, 404);
    assert.equal(
      log.events().events.some((item) => item.event === 'screenshot.captured'),
      false,
    );
    const screenshot = await fetch(server.url + '/debug/screenshot', { headers });
    assert.equal(screenshot.headers.get('content-type'), 'image/png');
    assert.equal(await screenshot.text(), 'test-png');
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('generation diagnostics retain request IDs, progress and parser failure after completion', async () => {
  const store = new Store(':memory:');
  const log = new Diagnostics();
  store.setSetting('preferences', JSON.stringify({ model: 'test/model' }));
  store.create(defaultCharacter);
  const service = new DialogueService(
    store,
    async () => 'super-secret-key',
    () => {},
    async function* () {
      yield '{"type":"speech","expression":"face_01","text":"valid"}\n';
      yield 'invalid\n';
    },
    log,
  );
  try {
    await service.send('question');
    for (let i = 0; service.busy && i < 100; i++)
      await new Promise((resolve) => setImmediate(resolve));
    const state = service.diagnosticState();
    assert.equal(state.progress?.outcome, 'error');
    assert.equal(state.progress?.chunks, 2);
    assert.equal(state.progress?.parser.invalidLines, 1);
    const event = log.events().events.find((item) => item.event === 'jsonl.invalid');
    assert.equal(event?.data.sessionId, store.currentId());
    assert.ok(event?.data.messageId);
    assert.doesNotMatch(JSON.stringify(log.events()), /super-secret-key/);
  } finally {
    await service.stop();
    store.close();
  }
});

test('HTTP handler validates auth, origin, host, method and diagnostic routes without sockets', async () => {
  const log = new Diagnostics();
  let captures = 0;
  const handler = createDebugHandler(
    {
      directory: 'unused',
      diagnostics: log,
      state: () => ({ summary: 'waiting_for_page_advance', apiKey: 'secret' }),
      screenshot: async () => {
        captures++;
        return Buffer.from('png');
      },
    },
    'test-token',
    12345,
  );
  const request = async (
    path: string,
    options: { auth?: string; host?: string; method?: string; origin?: string } = {},
  ) => {
    const incoming = new IncomingMessage(new Socket());
    incoming.url = path;
    incoming.method = options.method ?? 'GET';
    incoming.headers = {
      host: options.host ?? '127.0.0.1:12345',
      authorization: options.auth ?? 'Bearer test-token',
      ...(options.origin ? { origin: options.origin } : {}),
    };
    const response = new ServerResponse(incoming);
    let body: string | Buffer = '';
    response.end = ((value: string | Buffer) => {
      body = value;
      return response;
    }) as typeof response.end;
    await handler(incoming, response);
    incoming.destroy();
    return {
      status: response.statusCode,
      body: String(body),
      type: response.getHeader('content-type'),
    };
  };
  assert.equal((await request('/debug/state', { auth: '' })).status, 401);
  assert.equal((await request('/debug/state', { origin: 'http://example.org' })).status, 403);
  assert.equal((await request('/debug/state', { host: 'attacker.example:12345' })).status, 403);
  assert.equal((await request('/debug/state', { method: 'POST' })).status, 405);
  const state = await request('/debug/state');
  assert.equal(state.status, 200);
  assert.equal(JSON.parse(state.body).summary, 'waiting_for_page_advance');
  assert.equal(JSON.parse(state.body).apiKey, '[REDACTED]');
  assert.equal(captures, 0);
  log.record('example');
  assert.equal(JSON.parse((await request('/debug/events?since=0&limit=1')).body).events.length, 1);
  assert.equal((await request('/debug/events?limit=501')).status, 400);
  assert.equal((await request('/unknown')).status, 404);
  const screenshot = await request('/debug/screenshot');
  assert.equal(screenshot.body, 'png');
  assert.equal(screenshot.type, 'image/png');
  assert.equal(captures, 1);
});

test('latest state is persisted atomically with renderer status and secret redaction', () => {
  const directory = temp();
  try {
    const log = new Diagnostics(directory);
    log.addSecret('sensitive-test-value');
    log.updateUi({ source: 'app', sessionId: 's', error: 'sensitive-test-value' });
    log.persistState({
      summary: 'generation_error',
      generation: { pendingCharacters: 80 },
      apiKey: 'secret',
    });
    const output = readFileSync(join(directory, 'state.json'), 'utf8');
    const state = JSON.parse(output);
    assert.equal(state.summary, 'generation_error');
    assert.equal(state.generation.pendingCharacters, 80);
    assert.equal(state.renderer.app.sessionId, 's');
    assert.equal(state.apiKey, '[REDACTED]');
    assert.doesNotMatch(output, /sensitive-test-value/);
    assert.equal(statSync(join(directory, 'state.json')).mode & 0o777, 0o600);
    assert.ok(state.capturedAt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('raw responses preserve full received text on success, parse failure, disconnect and stop', async () => {
  const directory = temp();
  try {
    for (const outcome of ['complete', 'invalid', 'disconnect', 'stop'] as const) {
      const log = new Diagnostics(directory, true);
      log.addSecret('private-api-secret');
      const store = new Store(':memory:');
      store.create(defaultCharacter);
      store.setSetting('preferences', JSON.stringify({ model: 'test/model' }));
      const raw =
        outcome === 'complete'
          ? JSON.stringify({
              type: 'speech',
              expression: 'face_01',
              text: '長'.repeat(6000) + 'private-api-secret',
            }) + '\n'
          : '{"wrong":"形式エラー private-api-secret"}';
      const service = new DialogueService(
        store,
        async () => 'key',
        () => {},
        async function* (request) {
          yield raw.slice(0, 15);
          yield raw.slice(15);
          if (outcome === 'disconnect') throw new Error('connection lost');
          if (outcome === 'stop')
            await new Promise<void>((resolve) => {
              if (request.signal.aborted) resolve();
              else request.signal.addEventListener('abort', () => resolve(), { once: true });
            });
        },
        log,
      );
      try {
        await service.send('質問');
        const messageId = store.current().messages.at(-1)!.id;
        const file = join(directory, 'responses', `${messageId}.json`);
        // The first received chunk is persisted before generation has finished.
        if (outcome === 'stop') {
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(JSON.parse(readFileSync(file, 'utf8')).outcome, 'generating');
          await service.stop();
        }
        for (let i = 0; service.busy && i < 100; i++)
          await new Promise((resolve) => setImmediate(resolve));
        assert.equal(service.busy, false);
        const response = JSON.parse(readFileSync(file, 'utf8'));
        assert.equal(response.text, raw.replaceAll('private-api-secret', '[REDACTED]'));
        assert.equal(
          response.outcome,
          outcome === 'complete' ? 'complete' : outcome === 'stop' ? 'interrupted' : 'error',
        );
        assert.equal(response.sessionId, store.currentId());
        assert.equal(response.model, 'test/model');
        assert.equal(statSync(file).mode & 0o777, 0o600);
        assert.ok(log.events().events.some((entry) => entry.event === 'generation.raw_response'));
      } finally {
        await service.stop();
        store.close();
      }
    }
    const disabled = new Diagnostics(directory);
    disabled.persistResponse({
      sessionId: 's',
      messageId: 'disabled',
      model: 'm',
      outcome: 'complete',
      text: 'not retained',
    });
    assert.throws(() => readFileSync(join(directory, 'responses', 'disabled.json')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

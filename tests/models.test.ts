import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels } from '../src/core/models.ts';
import { normalizeBaseUrl, DEFAULT_BASE_URL } from '../src/shared/connection.ts';

test('base URLs normalize trailing slashes and reject invalid endpoints and URL credentials', () => {
  assert.equal(normalizeBaseUrl(' https://example.com/api/v1/// '), 'https://example.com/api/v1');
  assert.equal(normalizeBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1');
  for (const value of [
    '',
    'garbage',
    'file:///tmp/api',
    'https://key@example.com/v1',
    'https://example.com/v1?key=secret',
    'https://example.com/v1#x',
    DEFAULT_BASE_URL + '/chat/completions',
    DEFAULT_BASE_URL + '/models/',
  ]) {
    assert.throws(() => normalizeBaseUrl(value));
  }
});

test('model lists accept generic/OpenRouter records, search names, duplicates and known output modalities', async () => {
  for (const key of ['', 'test-key']) {
    const fetcher = (async (url, options) => {
      assert.equal(url, 'http://localhost:1234/v1/models');
      assert.equal(options?.method, 'GET');
      assert.equal(
        new Headers(options?.headers).get('Authorization'),
        key ? `Bearer ${key}` : null,
      );
      assert.equal(options?.redirect, 'error');
      assert.ok(options?.signal);
      return Response.json({
        data: [
          { id: 'generic' },
          { id: 'named', name: 'Friendly Name', architecture: { output_modalities: ['text'] } },
          { id: 'image', architecture: { output_modalities: ['image'] } },
          { id: 'generic' },
          { id: '' },
          { name: 'no ID' },
          null,
        ],
      });
    }) as typeof fetch;
    const result = await listModels('http://localhost:1234/v1/', key, fetcher);
    assert.deepEqual(new Set(result.map((item) => item.id)), new Set(['generic', 'named']));
    assert.equal(result.find((item) => item.id === 'named')?.name, 'Friendly Name');
  }
});

test('list errors distinguish authentication, unsupported endpoints, malformed data and connectivity without exposing response bodies', async () => {
  for (const [status, expected] of [
    [401, /認証/],
    [403, /認証/],
    [404, /GET \/models/],
    [405, /GET \/models/],
    [429, /利用制限/],
    [500, /エラー/],
  ] as const) {
    await assert.rejects(
      () =>
        listModels(
          DEFAULT_BASE_URL,
          'test-key',
          (async () => new Response('secret body', { status })) as typeof fetch,
        ),
      (error: Error) => expected.test(error.message) && !error.message.includes('secret body'),
    );
  }
  for (const body of ['not JSON', '{}', '{"data":[]}', '{"data":[{"id":12}]}']) {
    await assert.rejects(
      () => listModels(DEFAULT_BASE_URL, '', (async () => new Response(body)) as typeof fetch),
      /手入力/,
    );
  }
  await assert.rejects(
    () =>
      listModels(DEFAULT_BASE_URL, '', (async () => {
        throw new Error('network private details');
      }) as typeof fetch),
    /接続できません/,
  );
});

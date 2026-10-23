import test from 'node:test';
import assert from 'node:assert/strict';
import { streamOpenRouter } from '../src/core/openrouter.ts';
import { sseData } from '../src/core/sse.ts';

function byteStream(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let index = 0; index < bytes.length; index += 1) controller.enqueue(bytes.slice(index, index + 1));
    controller.close();
  } });
}
const request = { key: 'test-only', model: 'test/model', messages: [], signal: new AbortController().signal };
const content = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
const finished = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
async function collect(stream: AsyncIterable<string>) { const values = []; for await (const item of stream) values.push(item); return values; }

test('SSE parses multibyte UTF-8, split CRLF, comments and multiline data', async () => {
  assert.deepEqual(await collect(sseData(byteStream(': keepalive\r\ndata: あ\r\ndata: い\r\n\r\n'))), ['あ\nい']);
});

test('OpenRouter transports only content and requires a normal finish', async () => {
  let body: Record<string, unknown> = {};
  const fetcher = (async (_url, options) => {
    body = JSON.parse(options?.body as string);
    return new Response(byteStream(': keepalive\n\n' + content('こんにちは') + finished));
  }) as typeof fetch;
  assert.deepEqual(await collect(streamOpenRouter(request, fetcher)), ['こんにちは']);
  assert.equal(body.stream, true);
  assert.equal(body.model, 'test/model');
});

test('HTTP failure, midstream error, token limit and truncated stream are errors', async () => {
  for (const response of [
    new Response('unauthorized', { status: 401 }),
    new Response(byteStream(content('first') + 'data: {"error":{"message":"provider secret"}}\n\n')),
    new Response(byteStream('data: {"choices":[{"finish_reason":"length"}]}\n\n')),
    new Response(byteStream(content('first'))),
    new Response(byteStream('data: [DONE]\n\n')),
  ]) {
    await assert.rejects(() => collect(streamOpenRouter(request, (async () => response) as typeof fetch)));
  }
});

test('no tool or reasoning fields are treated as user-visible text', async () => {
  const stream = 'data: {"choices":[{"delta":{"reasoning":"hidden","tool_calls":[]}}]}\n\n' + finished;
  assert.deepEqual(await collect(streamOpenRouter(request, (async () => new Response(byteStream(stream))) as typeof fetch)), []);
});

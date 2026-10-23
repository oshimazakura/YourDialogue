import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.ts';
import { DialogueService } from '../src/core/service.ts';
import { defaultCharacter } from '../src/shared/character.ts';
import type { ChatRequest } from '../src/core/chat-completions.ts';

const line = (text: string) =>
  JSON.stringify({ type: 'speech', expression: 'face_01', text }) + '\n';
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(service: DialogueService) {
  for (let i = 0; service.busy && i < 100; i++) await tick();
  assert.equal(service.busy, false);
}
function setup(stream: (request: ChatRequest) => AsyncIterable<string>) {
  const store = new Store(':memory:');
  store.setSetting('preferences', JSON.stringify({ model: 'test/model' }));
  store.create(defaultCharacter);
  const service = new DialogueService(
    store,
    async () => 'test-key',
    () => {},
    stream,
  );
  return { store, service };
}

test('first send persists the session and completed lines; stop discards the unfinished line', async () => {
  const { store, service } = setup(async function* (request) {
    yield line('完成');
    yield '{"type":"speech","text":"途中';
    await new Promise<void>((resolve) =>
      request.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  });
  try {
    await service.send('質問');
    await tick();
    assert.equal(store.current().messages.at(-1)?.segments.length, 1);
    assert.equal(store.list().length, 1);
    await service.stop();
    assert.equal(store.current().messages.at(-1)?.status, 'interrupted');
    assert.equal(store.current().messages.at(-1)?.segments.length, 1);
  } finally {
    await service.stop();
    store.close();
  }
});

test('valid EOF row completes; retry replaces the previous response', async () => {
  const { store, service } = setup(async function* () {
    yield line('返答').trimEnd();
  });
  try {
    await service.send('質問');
    await settle(service);
    assert.equal(store.current().messages.at(-1)?.status, 'complete');
    assert.equal(store.current().messages.at(-1)?.segments.length, 1);
    await service.send('', undefined, true);
    await settle(service);
    assert.equal(store.current().messages.length, 2);
  } finally {
    await service.stop();
    store.close();
  }
});

test('invalid output and transport errors retain earlier content and mark the answer failed', async () => {
  const { store, service } = setup(async function* () {
    yield line('受信済み');
    throw new Error('切断');
  });
  try {
    await service.send('質問');
    await settle(service);
    assert.equal(store.current().messages.at(-1)?.status, 'error');
    assert.equal(store.current().messages.at(-1)?.segments[0].text, '受信済み');
    assert.equal(store.current().messages.at(-1)?.error, '切断');
  } finally {
    await service.stop();
    store.close();
  }
});

test('missing configuration and overlapping sends do not duplicate user messages', async () => {
  const { store, service } = setup(async function* (request) {
    yield line('受信');
    await new Promise<void>((resolve) =>
      request.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  });
  try {
    assert.equal(store.list().length, 0);
    const first = service.send('最初');
    await assert.rejects(() => service.send('重複'));
    await first;
    await tick();
    assert.equal(store.current().messages.filter((item) => item.role === 'user').length, 1);
    await service.stop();
    store.setSetting('preferences', JSON.stringify({ model: '' }));
    await assert.rejects(() => service.send('失敗'));
    assert.equal(store.current().messages.length, 2);
  } finally {
    await service.stop();
    store.close();
  }
});

test('opening a session stops generation and continues it without creating another session', async () => {
  const { store, service } = setup(async function* (request) {
    yield line('保存された返答');
    await new Promise<void>((resolve) =>
      request.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  });
  try {
    const copy = store.current();
    store.addUser('既存の質問');
    store.beginAssistant();
    store.finish(copy.id, store.current().messages.at(-1)!.id, 'complete');
    store.create(defaultCharacter);
    await service.send('質問');
    await tick();
    const original = store.currentId()!;
    await service.open(copy.id);
    assert.equal(service.busy, false);
    assert.equal(store.currentId(), copy.id);
    assert.equal(store.list().length, 2);
    assert.equal(store.get(original).messages.at(-1)?.status, 'interrupted');
    await service.send('続けよう');
    await tick();
    assert.equal(store.current().messages.length, 4);
    assert.equal(store.get(original).messages.length, 2);
  } finally {
    await service.stop();
    store.close();
  }
});

test('stop during API key retrieval waits for setup and interrupts the new request', async () => {
  const store = new Store(':memory:');
  store.setSetting('preferences', JSON.stringify({ model: 'test/model' }));
  store.create(defaultCharacter);
  let release: (key: string) => void = () => {};
  const key = new Promise<string>((resolve) => {
    release = resolve;
  });
  const service = new DialogueService(
    store,
    () => key,
    () => {},
    async function* (request) {
      request.signal.throwIfAborted();
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) resolve();
        else request.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  );
  try {
    const send = service.send('質問');
    const stopping = service.stop();
    assert.equal(service.busy, true);
    release('key');
    await send;
    await stopping;
    assert.equal(service.busy, false);
    assert.equal(store.current().messages.at(-1)?.status, 'interrupted');
  } finally {
    await service.stop();
    store.close();
  }
});

test('configuration failure leaves a new session as an unsaved draft', async () => {
  const { store, service } = setup(async function* () {
    yield line('返答');
  });
  try {
    const draftId = store.currentId();
    store.setSetting('preferences', JSON.stringify({ model: '' }));
    await assert.rejects(() => service.send('質問'));
    assert.equal(store.currentId(), draftId);
    assert.equal(store.list().length, 0);
    assert.equal(store.current().messages.length, 0);
  } finally {
    await service.stop();
    store.close();
  }
});

test('a custom keyless connection reaches generation with the saved base URL and model', async () => {
  const store = new Store(':memory:');
  store.setSetting(
    'preferences',
    JSON.stringify({ baseUrl: 'http://localhost:1234/v1/', model: 'local/model' }),
  );
  store.create(defaultCharacter);
  const service = new DialogueService(
    store,
    async () => '',
    () => {},
    async function* (request) {
      assert.equal(request.baseUrl, 'http://localhost:1234/v1');
      assert.equal(request.key, '');
      assert.equal(request.model, 'local/model');
      yield line('ローカルの返答');
    },
  );
  try {
    await service.send('質問');
    await settle(service);
    assert.equal(store.current().messages.at(-1)?.status, 'complete');
    assert.equal(store.list().length, 1);
  } finally {
    await service.stop();
    store.close();
  }
});

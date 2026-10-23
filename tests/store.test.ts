import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store.ts';
import { defaultCharacter } from '../src/shared/character.ts';
import { conversationMessages } from '../src/core/prompt.ts';

test('new sessions remain drafts until the first user message, including greetings', () => {
  const store = new Store(':memory:');
  try {
    const first = store.create({ ...defaultCharacter, greeting: 'こんにちは' });
    assert.equal(first.messages.length, 1);
    assert.equal(store.list().length, 0);
    assert.equal(store.getSetting('currentId'), undefined);
    const second = store.create(defaultCharacter);
    assert.throws(() => store.get(first.id));
    assert.equal(store.list().length, 0);
    store.addUser('最初の質問');
    assert.equal(store.list().length, 1);
    assert.equal(store.getSetting('currentId'), second.id);
    assert.equal(store.current().title, '最初の質問');
    const draft = store.create(defaultCharacter);
    assert.equal(store.list().length, 1);
    store.select(second.id);
    assert.equal(store.currentId(), second.id);
    assert.throws(() => store.get(draft.id));
  } finally {
    store.close();
  }
});

test('editing truncates only the active session; PHONE remains in model context', () => {
  const store = new Store(':memory:');
  try {
    const session = store.create(defaultCharacter);
    const user = store.addUser('東京');
    const assistant = store.beginAssistant();
    store.append(session.id, assistant.id, { type: 'phone', format: 'markdown', text: '浅草' });
    store.finish(session.id, assistant.id, 'complete');
    assert.match(
      conversationMessages(session.character, store.current().messages)[2].content,
      /浅草/,
    );
    const saved = store.create(defaultCharacter);
    store.addUser('別の会話');
    store.select(session.id);
    store.addUser('行き方は？');
    store.edit(user.id, '京都');
    assert.deepEqual(
      store.current().messages.map((item) => item.text),
      ['京都'],
    );
    assert.equal(store.get(saved.id).messages[0].text, '別の会話');
    assert.equal(store.get(saved.id).messages.length, 1);
  } finally {
    store.close();
  }
});

test('restart restores the selected session and marks in-flight responses interrupted', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yourdialogue-'));
  const path = join(directory, 'test.sqlite');
  let store = new Store(path);
  try {
    const session = store.create(defaultCharacter);
    store.addUser('こんにちは');
    const assistant = store.beginAssistant();
    store.append(session.id, assistant.id, {
      type: 'speech',
      expression: 'face_01',
      text: 'こんにちは',
    });
    store.create({ ...defaultCharacter, greeting: '未送信' });
    store.close();
    store = new Store(path);
    assert.equal(store.list().length, 1);
    assert.equal(store.currentId(), session.id);
    assert.equal(store.current().messages.at(-1)?.status, 'interrupted');
    assert.equal(store.current().messages.at(-1)?.segments[0].text, 'こんにちは');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('first send persists the greeting and deleting history preserves a current draft', () => {
  const store = new Store(':memory:');
  try {
    const session = store.create({ ...defaultCharacter, greeting: '「やあ」' });
    store.addUser('こんにちは');
    assert.equal(store.list()[0].messages.length, 2);
    const draft = store.create(defaultCharacter);
    store.delete(session.id);
    assert.equal(store.currentId(), draft.id);
    assert.equal(store.list().length, 0);
    store.addUser('別の会話');
    assert.equal(store.list()[0].id, draft.id);
  } finally {
    store.close();
  }
});

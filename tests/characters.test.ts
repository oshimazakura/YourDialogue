import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import { parseCharacterCard, cardJsonFromPng, crc32 } from '../src/core/character-card.ts';
import { defaultPlacement, validateCharacter } from '../src/core/characters.ts';
import { AssetStore } from '../src/core/assets.ts';
import { checkImageSize } from '../src/core/image-size.ts';
import { Store } from '../src/core/store.ts';
import { defaultCharacter } from '../src/shared/character.ts';
import { systemPrompt, conversationMessages } from '../src/core/prompt.ts';

function chunk(type: string, data: Buffer) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length, 0);
  bytes.write(type, 4, 'ascii');
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4);
  return bytes;
}
function png(json?: string, keyword = 'chara') {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...(json
      ? [chunk('tEXt', Buffer.from(keyword + '\0' + Buffer.from(json).toString('base64')))]
      : []),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const card = {
  name: 'テスト',
  description: '{{char}}は{{user}}を手伝う。',
  personality: '穏やか',
  scenario: '図書室',
  first_mes: 'こんにちは、{{user}}。{{char}}です。',
  mes_example: '{{char}}: どうぞ。',
};

test('V1 and V2 imports map settings and retain unknown fields without requiring a model', () => {
  const v1 = parseCharacterCard(JSON.stringify({ ...card, future: { custom: true } }));
  assert.equal(v1.greeting, card.first_mes);
  assert.equal(v1.personality, card.personality);
  assert.equal(v1.importedCard?.version, 1);
  assert.deepEqual(v1.importedCard?.original.future, { custom: true });
  const original = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      ...card,
      system_prompt: 'override',
      post_history_instructions: 'extra',
      alternate_greetings: ['other'],
      character_book: { entries: [] },
      extensions: { unknown: { nested: 'kept' } },
    },
    future: 'keep',
  };
  const v2 = parseCharacterCard(JSON.stringify(original));
  assert.deepEqual(v2.importedCard?.original, original);
  assert.equal(v2.importedCard?.warnings.length, 5);
  assert.doesNotMatch(systemPrompt(v2), /override/);
  assert.match(systemPrompt(v2), /テストはYOUを手伝う/);
  assert.match(systemPrompt(v2), /図書室/);
  assert.match(systemPrompt(v2), /穏やか/);
});

test('PNG cards decode Unicode metadata; malformed, corrupted and unsupported cards report errors', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const bytes = png(JSON.stringify(card));
  assert.equal(parseCharacterCard(cardJsonFromPng(bytes)).name, 'テスト');
  assert.throws(() => cardJsonFromPng(bytes.subarray(0, -3)), /途中/);
  const corrupt = Buffer.from(bytes);
  corrupt[40] ^= 1;
  assert.throws(() => cardJsonFromPng(corrupt), /破損/);
  assert.throws(() => cardJsonFromPng(png()), /設定がありません/);
  assert.throws(() => cardJsonFromPng(png('{}', 'ccv3')), /V3/);
  assert.throws(() => parseCharacterCard('{broken'), /JSON/);
  assert.throws(() => parseCharacterCard('{"spec":"chara_card_v3"}'), /V1またはV2/);
  assert.throws(() => parseCharacterCard('{"name": 5}'), /name/);
});

test('character validation prevents duplicate IDs, unknown defaults, foreign paths and invalid placement', () => {
  const valid = validateCharacter(defaultCharacter);
  assert.deepEqual(valid.placement, defaultPlacement);
  for (const update of [
    { name: '' },
    { defaultExpression: 'missing' },
    { background: 'file:///etc/passwd' },
    { background: 'https://example.com/image.png' },
    { placement: { scale: 1, x: 200, y: 0 } },
    { expressions: [{ ...valid.expressions[0], image: '../../private.png' }] },
    { expressions: [valid.expressions[0], valid.expressions[0]] },
  ])
    assert.throws(() => validateCharacter({ ...valid, ...update }));
});

test('greetings appear in drafts, enter model context and do not prevent first-question titles', () => {
  const store = new Store(':memory:');
  try {
    store.seedCharacters(defaultCharacter);
    const character = validateCharacter({ ...defaultCharacter, greeting: card.first_mes });
    store.saveCharacter(character);
    const session = store.create(store.characterForNewSession());
    assert.equal(session.messages.length, 1);
    assert.equal(session.messages[0].greeting, true);
    assert.equal(session.messages[0].segments[0].text, 'こんにちは、YOU。Aliceです。');
    assert.equal(session.messages[0].status, 'complete');
    store.addUser('最初の質問');
    assert.equal(store.current().title, '最初の質問');
    assert.equal(conversationMessages(character, store.current().messages).length, 3);
    assert.equal(
      store.current().messages[0].segments[0].text,
      session.messages[0].segments[0].text,
    );
  } finally {
    store.close();
  }
});

test('library edits affect only new sessions and deleted characters leave snapshots usable', () => {
  const store = new Store(':memory:');
  try {
    store.seedCharacters(defaultCharacter);
    const first = store.create(store.characterForNewSession());
    store.addUser('会話を保存');
    store.saveCharacter({
      ...defaultCharacter,
      name: '更新後',
      greeting: '新しい挨拶',
      background: '',
    });
    assert.equal(store.get(first.id).character.name, 'Alice');
    const second = store.create(store.characterForNewSession());
    assert.equal(second.character.name, '更新後');
    assert.equal(store.listCharacters().length, 1);
    store.saveCharacter({ ...defaultCharacter, id: 'other', name: '別のキャラ' });
    store.deleteCharacter('alice');
    assert.equal(store.get(first.id).character.name, 'Alice');
    assert.equal(store.get(second.id).character.name, '更新後');
    assert.throws(() => store.deleteCharacter('other'), /少なくとも1人/);
    store.select(first.id);
    assert.equal(store.characterForNewSession().name, 'Alice');
    assert.equal(store.characterForNewSession('other').name, '別のキャラ');
  } finally {
    store.close();
  }
});

test('character library survives restart without reseeding over user edits', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dialogue-library-'));
  let store = new Store(join(directory, 'test.sqlite'));
  try {
    store.seedCharacters(defaultCharacter);
    store.saveCharacter({ ...defaultCharacter, name: '保持する名前' });
    store.close();
    store = new Store(join(directory, 'test.sqlite'));
    store.seedCharacters(defaultCharacter);
    assert.equal(store.character('alice').name, '保持する名前');
    assert.equal(store.listCharacters().length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('assets are immutable owned copies; image sizes and traversal attempts are validated', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dialogue-assets-'));
  try {
    const assets = new AssetStore(join(directory, 'owned'));
    const source = png();
    assert.deepEqual(checkImageSize(source), { width: 1, height: 1 });
    const url = assets.putPng(source);
    assert.equal(assets.putPng(source), url);
    assert.equal(readdirSync(join(directory, 'owned')).length, 1);
    writeFileSync(join(directory, 'original.png'), 'replaced source');
    assert.deepEqual(assets.read(url), source);
    const other = assets.putPng(png(JSON.stringify(card)));
    assert.notEqual(other, url);
    assert.deepEqual(assets.read(url), source);
    assert.throws(() => assets.read('dialogue-asset://local/../../test'));
    const huge = Buffer.from(source);
    huge.writeUInt32BE(100_000, 16);
    assert.throws(() => checkImageSize(huge), /8192/);
    assert.throws(() => checkImageSize(Buffer.from('not an image')), /PNG/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('upgrading the original database preserves existing sessions and settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dialogue-upgrade-'));
  const path = join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  const session = {
    id: 'legacy',
    title: '保存済みの会話',
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
    character: defaultCharacter,
    messages: [],
  };
  legacy.exec(
    'CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1;',
  );
  legacy.prepare('INSERT INTO sessions VALUES (?,?)').run(session.id, JSON.stringify(session));
  legacy.prepare('INSERT INTO settings VALUES (?,?)').run('currentId', session.id);
  legacy
    .prepare('INSERT INTO settings VALUES (?,?)')
    .run('encryptedApiKey', 'unchanged-encrypted-value');
  legacy.close();
  const store = new Store(path);
  try {
    store.seedCharacters(defaultCharacter);
    assert.deepEqual(store.current(), session);
    assert.equal(store.getSetting('encryptedApiKey'), 'unchanged-encrypted-value');
    assert.equal(store.listCharacters().length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { splitGreeting, vnSegments, speechDisplayText } from '../src/core/narration.ts';
import { paginate } from '../src/renderer/pagination.ts';
import { JsonlDecoder } from '../src/core/jsonl.ts';
import { defaultCharacter } from '../src/shared/character.ts';
import { Store } from '../src/core/store.ts';
import { conversationMessages } from '../src/core/prompt.ts';
import type { Message, Segment } from '../src/shared/types.ts';

test('greetings split quoted dialogue and surrounding narration while preserving words', () => {
  for (const [open, close] of [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
  ]) {
    const source = `${open}こんにちは${close}\n\n彼女は手を振った。\n\n${open}どうぞ${close}`;
    const segments = splitGreeting(source, 'custom');
    assert.deepEqual(
      segments.map((item) => item.type),
      ['speech', 'narration', 'speech'],
    );
    assert.equal(segments[1].text, '彼女は手を振った。');
    assert.equal(segments.map((item) => item.text).join(''), source.replace(/\n/g, ''));
  }
  assert.deepEqual(splitGreeting('こんにちは。', 'face'), [
    { type: 'speech', expression: 'face', text: 'こんにちは。' },
  ]);
});

test('existing greeting messages are interpreted without rewriting saved history', () => {
  const message: Message = {
    id: 'old',
    role: 'assistant',
    text: '',
    status: 'complete',
    createdAt: '',
    greeting: true,
    segments: [
      { type: 'speech', expression: 'face_01', text: '彼女が現れた。「こんにちは」彼女は笑った。' },
    ],
  };
  const before = structuredClone(message);
  assert.deepEqual(
    vnSegments(message).map((item) => item.type),
    ['narration', 'speech', 'narration'],
  );
  assert.deepEqual(message, before);
  const context = conversationMessages(defaultCharacter, [message]);
  assert.match(context[1].content, /"type":"narration"/);
  assert.deepEqual(message, before);
});

test('narration pages retain kind and current expression through wrapping and resume speech', () => {
  const segments = [
    { type: 'narration' as const, text: '長めの地の文です。' },
    { type: 'speech' as const, expression: 'smile', text: 'こんにちは。' },
    { type: 'narration' as const, text: '彼女は笑った。' },
  ];
  const pages = paginate(segments, (text) => text.length <= 3, 'neutral');
  assert.equal(pages.map((item) => item.text).join(''), segments.map((item) => item.text).join(''));
  assert.equal(pages[0].kind, 'narration');
  assert.equal(pages[0].expression, 'neutral');
  assert.ok(pages.some((item) => item.kind === 'speech' && item.expression === 'smile'));
  assert.equal(pages.at(-1)?.kind, 'narration');
  assert.equal(pages.at(-1)?.expression, 'smile');
});

test('JSONL accepts explicit narration without an expression and persists it in a session', () => {
  const segments: Segment[] = [];
  const decoder = new JsonlDecoder(
    defaultCharacter,
    (item) => segments.push(item),
    () => assert.fail('valid narration'),
  );
  decoder.push('{"type":"narration","text":"彼女は頷いた。"}\n');
  assert.deepEqual(segments, [{ type: 'narration', text: '彼女は頷いた。' }]);
  const store = new Store(':memory:');
  try {
    const session = store.create(defaultCharacter);
    store.addUser('質問');
    const message = store.beginAssistant();
    store.append(session.id, message.id, segments[0]);
    store.finish(session.id, message.id, 'complete');
    store.select(session.id);
    assert.equal(store.current().messages[1].segments[0].type, 'narration');
    const greeted = store.create({ ...defaultCharacter, greeting: '「やあ」\n彼女は微笑んだ。' });
    assert.deepEqual(
      greeted.messages[0].segments.map((item) => item.type),
      ['speech', 'narration'],
    );
  } finally {
    store.close();
  }
});

test('speech display removes only outer quotation marks before pagination, leaving stored text intact', () => {
  for (const [open, close] of [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
  ]) {
    const text = `${open}長めの台詞です。${close}`;
    const segments = [{ type: 'speech' as const, expression: 'face', text }];
    const pages = paginate(segments, (value) => value.length <= 3);
    assert.equal(pages.map((page) => page.text).join(''), '長めの台詞です。');
    assert.equal(segments[0].text, text);
  }
  assert.equal(speechDisplayText('「その『例』を見て」'), 'その『例』を見て');
  assert.equal(speechDisplayText('彼女は「はい」と言った。'), '彼女は「はい」と言った。');
  assert.equal(speechDisplayText('「閉じていない'), '「閉じていない');
  assert.equal(
    paginate([{ type: 'narration', text: '「引用」を含む地の文' }], () => true)[0].text,
    '「引用」を含む地の文',
  );
});

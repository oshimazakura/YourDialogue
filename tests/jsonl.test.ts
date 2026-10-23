import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonlDecoder } from '../src/core/jsonl.ts';
import { defaultCharacter } from '../src/shared/character.ts';
import type { Segment } from '../src/shared/types.ts';

test('JSONL waits for a complete object, handles CRLF and escaped newlines', () => {
  const segments: Segment[] = [];
  const warnings: string[] = [];
  const decoder = new JsonlDecoder(
    defaultCharacter,
    (value) => segments.push(value),
    (value) => warnings.push(value),
  );
  decoder.push('{"type":"speech","expression":"face_03","text":"こ');
  assert.equal(segments.length, 0);
  decoder.push('んにちは"}\r\n{"type":"phone","format":"code","text":"a\\nb"}\n');
  assert.equal(segments.length, 2);
  assert.equal(segments[1].text, 'a\nb');
  assert.deepEqual(warnings, []);
});

test('unknown expression falls back, malformed lines do not discard later rows', () => {
  const segments: Segment[] = [];
  const warnings: string[] = [];
  const decoder = new JsonlDecoder(
    defaultCharacter,
    (value) => segments.push(value),
    (value) => warnings.push(value),
  );
  decoder.push(
    'not JSON\n{"type":"speech","expression":"unknown","text":"はい"}\n{"type":"phone","format":"html","text":"bad"}\n',
  );
  assert.deepEqual(segments, [{ type: 'speech', expression: 'face_01', text: 'はい' }]);
  assert.equal(warnings.length, 2);
});

test('normal completion accepts a final row without newline; partial row is never emitted', () => {
  const segments: Segment[] = [];
  const warnings: string[] = [];
  const decoder = new JsonlDecoder(
    defaultCharacter,
    (value) => segments.push(value),
    (value) => warnings.push(value),
  );
  decoder.push('{"type":"phone","format":"markdown","text":"# 完了"}');
  assert.equal(segments.length, 1);
  decoder.finish();
  assert.equal(segments.length, 1);
  decoder.push('{"type":"speech"');
  decoder.finish();
  assert.equal(segments.length, 1);
  assert.equal(warnings.length, 1);
});

test('persistence failures propagate instead of being mislabeled as malformed model output', () => {
  const decoder = new JsonlDecoder(
    defaultCharacter,
    () => {
      throw new Error('disk full');
    },
    () => assert.fail('not a JSON error'),
  );
  assert.throws(
    () => decoder.push('{"type":"speech","expression":"face_01","text":"保存"}\n'),
    /disk full/,
  );
});

test('concatenated objects stream across every chunk boundary without mistaking quoted braces or escapes', () => {
  const expected: Segment[] = [
    {
      type: 'speech',
      expression: 'face_01',
      text: '括弧 }{ と引用符 " とバックスラッシュ \\ と改行\n終わり',
    },
    { type: 'phone', format: 'code', text: 'const a = { nested: { value: "}" } };' },
    { type: 'narration', text: '彼女は頷いた。' },
  ];
  const source = expected
    .map((item) => JSON.stringify({ ...item, extra: { array: [{ brace: '}' }] } }))
    .join('');
  for (let split = 0; split <= source.length; split++) {
    const segments: Segment[] = [];
    const decoder = new JsonlDecoder(
      defaultCharacter,
      (value) => segments.push(value),
      () => assert.fail('valid concatenated objects'),
    );
    decoder.push(source.slice(0, split));
    decoder.push(source.slice(split));
    assert.deepEqual(segments, expected);
    decoder.finish();
    assert.deepEqual(segments, expected);
  }
  const segments: Segment[] = [];
  const decoder = new JsonlDecoder(
    defaultCharacter,
    (value) => segments.push(value),
    () => assert.fail('valid single-character chunks'),
  );
  for (const char of source) decoder.push(char);
  assert.deepEqual(segments, expected);
});

test('a complete object is saved before an adjacent partial object and interruption discards only the partial object', () => {
  const segments: Segment[] = [];
  const decoder = new JsonlDecoder(
    defaultCharacter,
    (value) => segments.push(value),
    () => assert.fail('no invalid complete record'),
  );
  const complete = JSON.stringify({ type: 'narration', text: '完了' });
  decoder.push(complete + '{"type":"speech","text":"途中');
  assert.equal(segments.length, 1);
  assert.ok(decoder.snapshot().pendingCharacters > 0);
  decoder.discard();
  assert.equal(decoder.snapshot().pendingCharacters, 0);
  decoder.push(complete);
  assert.equal(segments.length, 2);
});

test('malformed records recover at newlines and array wrappers are not accepted as objects', () => {
  const segments: Segment[] = [];
  const warnings: string[] = [];
  const decoder = new JsonlDecoder(
    defaultCharacter,
    (value) => segments.push(value),
    (value) => warnings.push(value),
  );
  const valid = JSON.stringify({ type: 'narration', text: '正常' });
  decoder.push('{"text":"unclosed\n' + '[' + valid + ']\n' + '{broken}' + valid + '\r\n');
  assert.deepEqual(segments, [{ type: 'narration', text: '正常' }]);
  assert.equal(warnings.length, 3);
});

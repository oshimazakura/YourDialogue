import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/renderer/pagination.ts';

test('pagination preserves every character, expression, and offset on resize', () => {
  const segments = [
    { type: 'speech' as const, expression: 'custom', text: 'こんにちは。\n長い文章です。👨‍👩‍👧‍👦' },
    { type: 'speech' as const, expression: 'other', text: '次の発話。' },
  ];
  for (const size of [1, 5, 20, 100]) {
    const pages = paginate(segments, (value) => [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)].length <= size);
    assert.equal(pages.map((page) => page.text).join(''), segments.map((item) => item.text).join(''));
    for (let index = 1; index < pages.length; index++) assert.equal(pages[index].start, pages[index - 1].end);
    assert.equal(pages.at(-1)?.expression, 'other');
    assert.ok(pages.some((page) => page.text.includes('👨‍👩‍👧‍👦')));
  }
});

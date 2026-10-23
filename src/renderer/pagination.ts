import { speechDisplayText } from '../core/narration.ts';
import type { VnSegment } from '../core/narration.ts';

export interface Page {
  text: string;
  expression: string;
  kind: VnSegment['type'];
  start: number;
  end: number;
}
export function paginate(
  segments: VnSegment[],
  fits: (text: string) => boolean,
  defaultExpression = 'face_01',
): Page[] {
  const pages: Page[] = [];
  let offset = 0;
  let expression = defaultExpression;
  for (const segment of segments) {
    if (segment.type === 'speech') expression = segment.expression;
    const characters = Array.from(
      new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(
        segment.type === 'speech' ? speechDisplayText(segment.text) : segment.text,
      ),
      (part) => part.segment,
    );
    let position = 0;
    while (position < characters.length) {
      let low = 1;
      let high = characters.length - position;
      let count = 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (fits(characters.slice(position, position + middle).join(''))) {
          count = middle;
          low = middle + 1;
        } else high = middle - 1;
      }
      const text = characters.slice(position, position + count).join('');
      pages.push({
        text,
        expression,
        kind: segment.type,
        start: offset,
        end: offset + text.length,
      });
      offset += text.length;
      position += count;
    }
  }
  return pages;
}

import type { Message, Narration, Speech } from '../shared/types.ts';

export type VnSegment = Speech | Narration;

// Cards store greetings as plain text. Treat quoted passages as dialogue and
// the surrounding prose as narration. Plain, unquoted greetings stay dialogue.
export function splitGreeting(text: string, expression: string): VnSegment[] {
  const quoted = /"(?:\\.|[^"\\])*"|“[^”]*”|「[^」]*」|『[^』]*』/gu;
  const matches = [...text.matchAll(quoted)];
  if (!matches.length) return [{ type: 'speech', expression, text }];
  const segments: VnSegment[] = [];
  let position = 0;
  for (const match of matches) {
    const prose = text.slice(position, match.index).trim();
    if (prose) segments.push({ type: 'narration', text: prose });
    segments.push({ type: 'speech', expression, text: match[0] });
    position = match.index + match[0].length;
  }
  const rest = text.slice(position).trim();
  if (rest) segments.push({ type: 'narration', text: rest });
  return segments;
}

// Remove only a complete outer dialogue delimiter; keep quotations within it.
export function speechDisplayText(text: string): string {
  const trimmed = text.trim();
  return /^(?:"(?:\\.|[^"\\])*"|“[^”]*”|「[^」]*」|『[^』]*』)$/u.test(trimmed)
    ? trimmed.slice(1, -1)
    : text;
}

export function vnSegments(message: Message): VnSegment[] {
  // Older sessions already saved their entire greeting as a single speech.
  // Interpret it on read without modifying the stored history.
  const first = message.segments[0];
  if (message.greeting && message.segments.length === 1 && first.type === 'speech') {
    return splitGreeting(first.text, first.expression);
  }
  return message.segments.filter((segment) => segment.type !== 'phone');
}

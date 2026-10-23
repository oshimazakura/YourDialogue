import type { Character, Segment } from '../shared/types.ts';
import type { DiagnosticSink } from './diagnostics.ts';

const MAX_LINE = 2_000_000;
export class JsonlDecoder {
  private buffer = '';
  private scanned = 0;
  private object = false;
  private started = false;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private line = 0;
  private validLines = 0;
  private invalidLines = 0;
  private character: Character;
  private emit: (segment: Segment) => void;
  private warn: (message: string) => void;
  private diagnostics: { record?: DiagnosticSink; includeContent?: boolean };
  constructor(
    character: Character,
    emit: (segment: Segment) => void,
    warn: (message: string) => void,
    diagnostics: { record?: DiagnosticSink; includeContent?: boolean } = {},
  ) {
    this.character = character;
    this.emit = emit;
    this.warn = warn;
    this.diagnostics = diagnostics;
  }
  snapshot() {
    return {
      lines: this.line,
      validLines: this.validLines,
      invalidLines: this.invalidLines,
      pendingCharacters: this.buffer.length,
    };
  }
  private preview(line: string) {
    // Preserve JSON structure by default, not conversational string contents.
    const preview = this.diagnostics.includeContent
      ? line
      : line
          .replace(/"(?:[^"\\]|\\.)*(?:"|$)/g, '"…"')
          .replace(/[^{}\[\]:,"\\\s`…]/g, '·')
          .replace(/·+/g, '…');
    return {
      preview: preview.slice(0, 600),
      tail: preview.length > 600 ? preview.slice(-120) : undefined,
      contentIncluded: !!this.diagnostics.includeContent,
    };
  }
  private resetScanner() {
    this.scanned = 0;
    this.object = false;
    this.started = false;
    this.depth = 0;
    this.quoted = false;
    this.escaped = false;
  }
  private consume(end: number, skip = 0) {
    const value = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end + skip);
    this.resetScanner();
    if (value.trim()) this.parse(value);
  }
  push(text: string) {
    this.buffer += text;
    // Scan only new characters, retaining quote/escape state across stream chunks.
    while (this.scanned < this.buffer.length) {
      const char = this.buffer[this.scanned++];
      // JSONL does not permit literal newlines inside a record. Recover at the
      // next line even if the previous record has an unclosed quote or brace.
      if (char === '\n') {
        this.consume(this.scanned - 1, 1);
        continue;
      }
      if (!this.started) {
        if (/\s/.test(char)) continue;
        this.started = true;
        this.object = char === '{';
      }
      // Do not extract nested objects from arrays or arbitrary non-JSON text.
      if (!this.object) continue;
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') this.quoted = false;
      } else if (char === '"') this.quoted = true;
      else if (char === '{') this.depth++;
      else if (char === '}' && --this.depth === 0) this.consume(this.scanned);
    }
    if (this.buffer.length > MAX_LINE) throw new Error('JSONLの1行が長すぎます。');
  }
  finish() {
    this.consume(this.buffer.length);
  }
  discard() {
    if (this.buffer.trim())
      this.diagnostics.record?.(
        'jsonl.partial_discarded',
        { line: this.line + 1, characters: this.buffer.length, ...this.preview(this.buffer) },
        'warn',
      );
    this.buffer = '';
    this.resetScanner();
  }
  private parse(line: string) {
    this.line += 1;
    if (!line.trim()) return;
    let segment: Segment;
    let reason = 'invalid_json';
    let position: number | undefined;
    try {
      if (line.length > MAX_LINE) {
        reason = 'line_too_long';
        throw new Error();
      }
      let value;
      try {
        value = JSON.parse(line);
      } catch (error) {
        const match = error instanceof Error ? /position (\d+)/.exec(error.message) : null;
        position = match ? Number(match[1]) : undefined;
        throw error;
      }
      reason = 'text_must_be_nonempty_string';
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.text !== 'string' ||
        !value.text.trim()
      )
        throw new Error();
      if (value.type === 'speech') {
        const known = this.character.expressions.some((item) => item.id === value.expression);
        const expression = known ? value.expression : this.character.defaultExpression;
        if (!known)
          this.diagnostics.record?.(
            'jsonl.expression_fallback',
            {
              line: this.line,
              expressionId: String(value.expression).slice(0, 100),
              fallback: expression,
            },
            'warn',
          );
        segment = { type: 'speech', expression, text: value.text };
      } else if (value.type === 'narration') {
        segment = { type: 'narration', text: value.text };
      } else if (value.type === 'phone' && ['text', 'markdown', 'code'].includes(value.format)) {
        segment = {
          type: 'phone',
          format: value.format,
          text: value.text,
          ...(typeof value.language === 'string' ? { language: value.language.slice(0, 80) } : {}),
        };
      } else {
        reason = value.type === 'phone' ? 'unsupported_phone_format' : 'unsupported_type';
        throw new Error();
      }
    } catch {
      this.invalidLines += 1;
      this.diagnostics.record?.(
        'jsonl.invalid',
        { line: this.line, reason, position, characters: line.length, ...this.preview(line) },
        'warn',
      );
      this.warn(`JSONLの${this.line}行目を読み取れなかったためスキップしました。`);
      return;
    }
    this.validLines += 1;
    this.diagnostics.record?.('jsonl.accepted', {
      line: this.line,
      type: segment.type,
      characters: segment.text.length,
    });
    this.emit(segment);
  }
}

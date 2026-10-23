// SSE is the transport; the content delta inside an event is a JSONL fragment.
export async function* sseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const line = (value: string): string | undefined => {
    if (value === '') {
      if (!data.length) return;
      const event = data.join('\n');
      data = [];
      return event;
    }
    if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break;
        const event = line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (event !== undefined) yield event;
      }
      if (buffer.length > 4_000_000 || data.join('').length > 4_000_000) throw new Error('受信イベントが長すぎます。');
      if (done) break;
    }
    // Dispatch only blank-line-terminated SSE events. EOF is not a delimiter.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

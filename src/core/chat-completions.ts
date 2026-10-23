import { normalizeBaseUrl } from '../shared/connection.ts';
import type { DiagnosticSink } from './diagnostics.ts';
import { sseData } from './sse.ts';
import type { conversationMessages } from './prompt.ts';

export interface ChatRequest {
  baseUrl: string;
  key: string;
  model: string;
  messages: ReturnType<typeof conversationMessages>;
  signal: AbortSignal;
  diagnose?: DiagnosticSink;
}
export async function* streamChatCompletions(
  request: ChatRequest,
  fetcher: typeof fetch = fetch,
): AsyncGenerator<string> {
  request.diagnose?.('provider.request', {
    baseUrl: request.baseUrl,
    model: request.model,
    contextMessages: request.messages.length,
  });
  const baseUrl = normalizeBaseUrl(request.baseUrl);
  const response = await fetcher(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      ...(request.key ? { Authorization: `Bearer ${request.key}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: request.model, messages: request.messages, stream: true }),
    signal: request.signal,
    redirect: 'error',
  });
  request.diagnose?.('provider.response', {
    status: response.status,
    contentType: response.headers.get('content-type'),
  });
  if (!response.ok) {
    await response.body?.cancel();
    const guidance: Record<number, string> = {
      400: 'モデルまたはリクエストを確認してください。会話が長すぎる場合は新しいセッションを作成してください。',
      401: 'APIキーを確認してください。',
      402: '接続先の残高を確認してください。',
      403: 'このモデルへのアクセスが許可されていません。',
      429: '利用制限に達しました。しばらく待ってから再試行してください。',
    };
    throw new Error(
      `LLM API (${response.status}): ${guidance[response.status] ?? '接続に失敗しました。時間をおいて再試行してください。'}`,
    );
  }
  if (!response.body) throw new Error('応答ストリームを取得できませんでした。');
  let finished = false;
  for await (const data of sseData(response.body)) {
    request.signal.throwIfAborted();
    if (data === '[DONE]') {
      request.diagnose?.('provider.done');
      if (!finished) throw new Error('応答が完了状態を通知せず終了しました。');
      return;
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      request.diagnose?.('provider.invalid_sse_json', { characters: data.length }, 'error');
      throw new Error('LLM APIの応答形式を読み取れませんでした。');
    }
    if (event.error) {
      request.diagnose?.(
        'provider.error',
        { code: event.error.code, message: event.error.message },
        'error',
      );
      throw new Error(
        'LLM APIの生成中にエラーが発生しました。モデルを確認するか、再試行してください。',
      );
    }
    const choice = event.choices?.[0];
    const reason = choice?.finish_reason;
    const text = choice?.delta?.content;
    if (typeof text === 'string' && text) yield text;
    if (reason) request.diagnose?.('provider.finish_reason', { reason });
    if (reason === 'stop') finished = true;
    else if (reason) {
      const detail =
        reason === 'length' ? '回答が長さの上限で中断されました。' : '回答が完了前に停止しました。';
      throw new Error(detail);
    }
  }
  if (!finished) throw new Error('通信が回答の途中で切断されました。');
}

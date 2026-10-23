import { normalizeBaseUrl } from '../shared/connection.ts';
import { Store } from './store.ts';
import { JsonlDecoder } from './jsonl.ts';
import { conversationMessages } from './prompt.ts';
import { streamChatCompletions } from './chat-completions.ts';
import type { AppState, Character, PublicSettings } from '../shared/types.ts';
import type { ChatRequest } from './chat-completions.ts';

import type { Diagnostics } from './diagnostics.ts';

type Stream = (request: ChatRequest) => AsyncIterable<string>;
export class DialogueService {
  readonly store: Store;
  private diagnostics?: Diagnostics;
  private progress: {
    baseUrl: string;
    sessionId: string;
    messageId: string;
    startedAt: string;
    lastContentAt: string | null;
    chunks: number;
    receivedCharacters: number;
    segments: number;
    outcome: string;
    parser: ReturnType<JsonlDecoder['snapshot']>;
  } | null = null;
  diagnosticState() {
    return {
      phase: this.starting ? 'preparing_connection' : this.active ? 'receiving' : 'idle',
      busy: this.busy,
      progress: this.progress && {
        ...this.progress,
        elapsedMs: Date.now() - Date.parse(this.progress.startedAt),
        contentIdleMs: this.progress.lastContentAt
          ? Date.now() - Date.parse(this.progress.lastContentAt)
          : null,
      },
    };
  }
  private stream: Stream;
  private emit: () => void;
  private getKey: () => Promise<string>;
  private active?: { controller: AbortController; done: Promise<void> };
  private starting = false;
  private startDone: Promise<void> = Promise.resolve();
  private finishStart: () => void = () => {};
  constructor(
    store: Store,
    getKey: () => Promise<string>,
    emit: () => void,
    stream: Stream = streamChatCompletions,
    diagnostics?: Diagnostics,
  ) {
    this.diagnostics = diagnostics;
    this.store = store;
    this.getKey = getKey;
    this.emit = emit;
    this.stream = stream;
  }
  get busy() {
    return this.starting || !!this.active;
  }
  state(settings: PublicSettings): AppState {
    return {
      characters: this.store.listCharacters(),
      sessions: this.store.list(),
      currentId: this.store.currentId(),
      currentSession: this.store.currentId() ? this.store.current() : null,
      settings,
      busy: this.busy,
    };
  }
  private assertIdle() {
    if (this.busy) throw new Error('現在の回答が終了するまでお待ちください。');
  }
  async stop() {
    await this.startDone;
    if (this.active) this.diagnostics?.record('generation.stop_requested');
    this.active?.controller.abort();
    await this.active?.done;
  }
  async create(character: Character) {
    if (this.starting) throw new Error('接続準備中です。少し待ってから操作してください。');
    await this.stop();
    this.store.create(character);
    this.emit();
  }
  async open(id: string) {
    if (this.starting) throw new Error('接続準備中です。少し待ってから操作してください。');
    this.store.get(id);
    await this.stop();
    this.store.select(id);
    this.emit();
  }
  async send(text: string, editedId?: string, retry = false) {
    this.assertIdle();
    if (!retry && (!text.trim() || text.length > 100_000))
      throw new Error('発言は1〜100,000文字で入力してください。');
    const preferences = this.store.preferences();
    const baseUrl = normalizeBaseUrl(preferences.baseUrl);
    const model = preferences.model.trim();
    if (!model) throw new Error('CONFIGでモデルを設定してください。');
    // Reserve the operation before awaiting keychain access, to prevent double sends.
    this.diagnostics?.record('generation.preparing', {
      baseUrl,
      sessionId: this.store.currentId(),
      model,
      operation: retry ? 'retry' : editedId ? 'edit' : 'send',
      inputCharacters: text.length,
    });
    this.starting = true;
    this.startDone = new Promise<void>((resolve) => {
      this.finishStart = resolve;
    });
    this.emit();
    let key: string;
    try {
      key = await this.getKey();
      this.diagnostics?.addSecret(key);
    } catch (error) {
      this.starting = false;
      this.finishStart();
      this.emit();
      this.diagnostics?.record(
        'generation.setup_failed',
        { error: error instanceof Error ? error.message : 'unknown' },
        'error',
      );
      throw error;
    }
    try {
      if (retry) this.store.prepareRetry();
      else if (editedId) this.store.edit(editedId, text.trim());
      else this.store.addUser(text.trim());
      const session = this.store.current();
      const messages = conversationMessages(session.character, session.messages);
      const assistant = this.store.beginAssistant();
      const controller = new AbortController();
      // A short async boundary ensures active is installed before finally clears it.
      const done = Promise.resolve().then(() =>
        this.generate(session.id, assistant.id, session.character, {
          baseUrl,
          key,
          model,
          messages,
          signal: controller.signal,
          diagnose: this.diagnostics?.record,
        }),
      );
      this.active = { controller, done };
      this.starting = false;
      this.finishStart();
      this.emit();
      // Generation continues via state events, rather than holding the IPC call open.
    } catch (error) {
      this.starting = false;
      this.finishStart();
      this.emit();
      this.diagnostics?.record(
        'generation.setup_failed',
        { error: error instanceof Error ? error.message : 'unknown' },
        'error',
      );
      throw error;
    }
  }
  private async generate(
    sessionId: string,
    messageId: string,
    character: Character,
    request: ChatRequest,
  ) {
    this.progress = {
      baseUrl: request.baseUrl,
      sessionId,
      messageId,
      startedAt: new Date().toISOString(),
      lastContentAt: null,
      chunks: 0,
      receivedCharacters: 0,
      segments: 0,
      outcome: 'generating',
      parser: { lines: 0, validLines: 0, invalidLines: 0, pendingCharacters: 0 },
    };
    const report = (
      event: string,
      data: Record<string, unknown> = {},
      level: 'info' | 'warn' | 'error' = 'info',
    ) => {
      this.diagnostics?.record(event, { sessionId, messageId, ...data }, level);
    };
    report('generation.started', {
      model: request.model,
      contextMessages: request.messages.length,
    });
    const warnings: string[] = [];
    let rawText = '';
    let lastRawWrite = 0;
    const persistRaw = () =>
      this.diagnostics?.persistResponse({
        baseUrl: request.baseUrl,
        sessionId,
        messageId,
        model: request.model,
        outcome: this.progress!.outcome,
        text: rawText,
      });
    let segments = 0;
    const decoder = new JsonlDecoder(
      character,
      (segment) => {
        this.store.append(sessionId, messageId, segment);
        segments += 1;
        this.progress!.segments = segments;
        report('segment.persisted', {
          type: segment.type,
          characters: segment.text.length,
          segments,
        });
        this.emit();
      },
      (warning) => {
        if (warnings.length < 5) warnings.push(warning);
      },
      { record: report, includeContent: this.diagnostics?.includeContent },
    );
    const timeout = setTimeout(
      () =>
        request.signal.aborted ||
        this.active?.controller.abort(new Error('回答がタイムアウトしました。')),
      180_000,
    );
    try {
      for await (const delta of this.stream(request)) {
        if (this.diagnostics?.includeContent) {
          rawText += delta;
          if (Date.now() - lastRawWrite >= 1000) {
            persistRaw();
            lastRawWrite = Date.now();
          }
        }
        request.signal.throwIfAborted();
        this.progress!.chunks += 1;
        this.progress!.receivedCharacters += delta.length;
        this.progress!.lastContentAt = new Date().toISOString();
        if (this.progress!.chunks === 1)
          report('generation.first_content', { characters: delta.length });
        decoder.push(delta);
        this.progress!.parser = decoder.snapshot();
      }
      request.signal.throwIfAborted();
      decoder.finish();
      this.progress!.parser = decoder.snapshot();
      if (!segments)
        throw new Error('表示できるJSONLを受信できませんでした。別のモデルで再試行してください。');
      this.progress!.outcome = warnings.length ? 'error' : 'complete';
      report(
        'generation.finished',
        { segments, warnings: warnings.length, parser: decoder.snapshot() },
        warnings.length ? 'warn' : 'info',
      );
      this.store.finish(
        sessionId,
        messageId,
        warnings.length ? 'error' : 'complete',
        warnings.join('\n') || undefined,
      );
    } catch (error) {
      // No decoder.finish() here: partial lines are intentionally discarded on interruption.
      const pendingCharacters = decoder.snapshot().pendingCharacters;
      decoder.discard();
      this.progress!.parser = decoder.snapshot();
      const aborted = request.signal.aborted;
      const timeoutError =
        aborted &&
        request.signal.reason instanceof Error &&
        request.signal.reason.name !== 'AbortError';
      const detail = timeoutError
        ? request.signal.reason.message
        : aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : '回答の生成に失敗しました。';
      this.progress!.outcome = aborted && !timeoutError ? 'interrupted' : 'error';
      report(
        'generation.failed',
        {
          aborted,
          timeout: !!timeoutError,
          error: detail,
          segments,
          discardedCharacters: pendingCharacters,
        },
        aborted && !timeoutError ? 'warn' : 'error',
      );
      this.store.finish(
        sessionId,
        messageId,
        aborted && !timeoutError ? 'interrupted' : 'error',
        detail,
      );
    } finally {
      persistRaw();
      if (this.diagnostics?.includeContent)
        report('generation.raw_response', {
          file: `responses/${messageId}.json`,
          characters: rawText.length,
          outcome: this.progress!.outcome,
          diskError: this.diagnostics.diskError,
        });
      clearTimeout(timeout);
      this.active = undefined;
      this.emit();
    }
  }
}

import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { diagnosticCharacter, describeCharacter } from './character-diagnostics.ts';
import type { Character } from '../shared/types.ts';
import { join } from 'node:path';

export type DiagnosticSink = (
  event: string,
  data?: Record<string, unknown>,
  level?: 'info' | 'warn' | 'error',
) => void;
export interface DiagnosticEvent {
  id: number;
  time: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  data: Record<string, unknown>;
}
export class Diagnostics {
  private entries: DiagnosticEvent[] = [];
  private draft: {
    character: Character;
    dirty: boolean;
    error: string | null;
    selectedExpression: number;
    reportedAt: string;
  } | null = null;
  private draftSignature = '';
  private characterSnapshot = '';
  private sequence = 0;
  private secrets: string[] = [];
  private ui: Record<string, unknown> = {};
  private uiSignature = '';
  private uiAt: string | null = null;
  private path?: string;
  private directory?: string;
  readonly includeContent: boolean;
  diskError: string | null = null;
  constructor(directory?: string, includeContent = false) {
    this.includeContent = includeContent;
    this.directory = directory;
    if (directory) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      this.path = join(directory, 'events.jsonl');
      // Rotate on startup as IDs restart for each process.
      if (existsSync(this.path)) renameSync(this.path, this.path + '.previous');
    }
  }
  addSecret(secret: string) {
    if (secret && !this.secrets.includes(secret)) this.secrets.push(secret);
  }
  sanitize(value: unknown, stringLimit = 4000): unknown {
    if (typeof value === 'string') {
      let text = value;
      for (const secret of this.secrets) text = text.split(secret).join('[REDACTED]');
      return text
        .replace(/\bsk-(?:or-v\d+-)?[A-Za-z0-9_-]+/g, '[REDACTED]')
        .replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]')
        .slice(0, stringLimit);
    }
    if (Array.isArray(value))
      return value.slice(0, 100).map((item) => this.sanitize(item, stringLimit));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 100)
          .map(([key, item]) => [
            key,
            /^(apiKey|authorization|token|key)$/i.test(key)
              ? '[REDACTED]'
              : this.sanitize(item, stringLimit),
          ]),
      );
    return value;
  }
  record: DiagnosticSink = (event, data = {}, level = 'info') => {
    const entry: DiagnosticEvent = {
      id: ++this.sequence,
      time: new Date().toISOString(),
      level,
      event,
      data: this.sanitize(data) as Record<string, unknown>,
    };
    this.entries.push(entry);
    if (this.entries.length > 500) this.entries.shift();
    if (this.path && !this.diskError) {
      try {
        if (existsSync(this.path) && statSync(this.path).size > 1_000_000)
          renameSync(this.path, this.path + '.previous');
        appendFileSync(this.path, JSON.stringify(entry) + '\n', { mode: 0o600 });
        chmodSync(this.path, 0o600);
      } catch {
        this.diskError = '診断ログをディスクに保存できません。メモリ内ログは取得できます。';
      }
    }
  };
  persistResponse(input: {
    sessionId: string;
    messageId: string;
    model: string;
    outcome: string;
    text: string;
  }) {
    if (!this.includeContent || !this.directory) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(input.messageId)) return;
    try {
      const directory = join(this.directory, 'responses');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, `${input.messageId}.json`);
      const data = this.sanitize(
        { ...input, capturedAt: new Date().toISOString() },
        Math.max(4000, input.text.length),
      );
      writeFileSync(path + '.tmp', JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
      renameSync(path + '.tmp', path);
    } catch {
      this.diskError = 'LLMの生テキストをディスクに保存できません。';
    }
  }
  events(since = 0, limit = 100) {
    return {
      events: this.entries
        .filter((item) => item.id > since)
        .slice(-Math.min(500, Math.max(1, limit))),
      latestId: this.sequence,
      oldestId: this.entries[0]?.id ?? null,
      diskError: this.diskError,
    };
  }
  updateUi(input: unknown) {
    if (!input || typeof input !== 'object') return;
    const value = input as Record<string, unknown>;
    if (value.source !== 'app' && value.source !== 'dialogue') return;
    const allowed =
      value.source === 'app'
        ? [
            'sessionId',
            'messageId',
            'panel',
            'busy',
            'sending',
            'error',
            'phoneItems',
            'sessionPersisted',
          ]
        : [
            'messageId',
            'phase',
            'page',
            'pageCount',
            'visibleCharacters',
            'totalCharacters',
            'expression',
            'segmentType',
            'speakerVisible',
            'viewportWidth',
            'viewportHeight',
          ];
    const fields = Object.fromEntries(
      allowed.filter((key) => key in value).map((key) => [key, value[key]]),
    );
    // Enforce a small, primitive-only payload from the renderer.
    if (
      Object.values(fields).some(
        (item) => item !== null && !['string', 'number', 'boolean'].includes(typeof item),
      )
    )
      return;
    const clean = this.sanitize(fields) as Record<string, unknown>;
    this.ui[value.source] = { ...((this.ui[value.source] as object) ?? {}), ...clean };
    this.uiAt = new Date().toISOString();
    const dialogue = this.ui.dialogue as Record<string, unknown> | undefined;
    const signature = JSON.stringify({
      app: this.ui.app,
      dialogue: dialogue && { ...dialogue, visibleCharacters: undefined },
    });
    if (signature !== this.uiSignature) {
      this.uiSignature = signature;
      this.record('ui.changed', { source: value.source, ...clean });
    }
  }
  updateCharacterDraft(input: unknown) {
    if (input === null) {
      this.draft = null;
      this.draftSignature = '';
      return;
    }
    if (!input || typeof input !== 'object') return;
    const value = input as Record<string, unknown>;
    if (!value.character || typeof value.character !== 'object' || typeof value.dirty !== 'boolean')
      return;
    this.draft = {
      character: diagnosticCharacter(value.character),
      dirty: value.dirty,
      error: typeof value.error === 'string' ? value.error.slice(0, 2000) : null,
      selectedExpression: Number.isSafeInteger(value.selectedExpression)
        ? (value.selectedExpression as number)
        : 0,
      reportedAt: new Date().toISOString(),
    };
    const signature = JSON.stringify([this.draft.character.id, this.draft.dirty, this.draft.error]);
    if (signature !== this.draftSignature) {
      this.draftSignature = signature;
      this.record('character.editor_changed', {
        characterId: this.draft.character.id,
        dirty: this.draft.dirty,
        error: this.draft.error,
      });
    }
  }
  characterEditor(content = false) {
    if (!this.draft) return null;
    return {
      dirty: this.draft.dirty,
      error: this.draft.error,
      selectedExpression: this.draft.selectedExpression,
      reportedAt: this.draft.reportedAt,
      character: describeCharacter(this.draft.character, content),
    };
  }
  persistCharacters(snapshot: unknown) {
    if (!this.directory) return;
    try {
      const snapshotKey = JSON.stringify(this.sanitize(snapshot, 100000));
      if (snapshotKey === this.characterSnapshot) return;
      const path = join(this.directory, 'characters.json');
      writeFileSync(
        path + '.tmp',
        JSON.stringify(
          this.sanitize(
            {
              schemaVersion: 1,
              pid: process.pid,
              capturedAt: new Date().toISOString(),
              ...(snapshot as object),
            },
            100000,
          ),
          null,
          2,
        ),
        { mode: 0o600 },
      );
      chmodSync(path + '.tmp', 0o600);
      renameSync(path + '.tmp', path);
      this.characterSnapshot = snapshotKey;
    } catch {
      this.diskError = 'キャラクター診断情報を保存できません。';
    }
  }
  persistState(state: unknown) {
    if (!this.directory) return;
    try {
      const path = join(this.directory, 'state.json');
      const temporary = path + '.tmp';
      writeFileSync(
        temporary,
        JSON.stringify(
          this.sanitize({
            schemaVersion: 1,
            pid: process.pid,
            capturedAt: new Date().toISOString(),
            ...(state as object),
            renderer: this.renderer(),
          }),
          null,
          2,
        ),
        { mode: 0o600 },
      );
      chmodSync(temporary, 0o600);
      renameSync(temporary, path);
    } catch {
      this.diskError = '最新の診断状態をディスクに保存できません。';
    }
  }
  clearUi() {
    this.draft = null;
    this.draftSignature = '';
    this.ui = {};
    this.uiAt = null;
    this.uiSignature = '';
  }
  renderer(): Record<string, unknown> & { lastReportedAt: string | null; ageMs: number | null } {
    return {
      ...this.ui,
      lastReportedAt: this.uiAt,
      ageMs: this.uiAt ? Date.now() - Date.parse(this.uiAt) : null,
    };
  }
}

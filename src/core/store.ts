import { splitGreeting } from './narration.ts';
import { DatabaseSync } from 'node:sqlite';
import { expandCharacterText } from './characters.ts';
import { randomUUID } from 'node:crypto';
import type { Character, Message, Preferences, Segment, Session } from '../shared/types.ts';

export const defaultPreferences: Preferences = {
  model: '',
  characterMs: 28,
  fontSize: 21,
  sound: true,
};

export class Store {
  private db: DatabaseSync;
  private draft: Session | null = null;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      PRAGMA user_version = 2;
    `);
    // A process exit cannot leave a response permanently "generating".
    for (const session of this.list()) {
      let changed = false;
      for (const message of session.messages) {
        if (message.status === 'generating') {
          message.status = 'interrupted';
          changed = true;
        }
      }
      if (changed) this.put(session, false);
    }
  }
  close() {
    this.db.close();
  }
  getSetting(key: string): string | undefined {
    return (
      this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        { value: string } | undefined
    )?.value;
  }
  setSetting(key: string, value: string) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, value);
  }
  preferences(): Preferences {
    return { ...defaultPreferences, ...JSON.parse(this.getSetting('preferences') ?? '{}') };
  }
  list(): Session[] {
    const rows = this.db.prepare('SELECT data FROM sessions').all() as { data: string }[];
    return rows
      .map((row) => JSON.parse(row.data) as Session)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id: string): Session {
    if (this.draft?.id === id) return structuredClone(this.draft);
    const row = this.db.prepare('SELECT data FROM sessions WHERE id = ?').get(id) as
      { data: string } | undefined;
    if (!row) throw new Error('セッションが見つかりません。');
    return JSON.parse(row.data);
  }
  put(session: Session, touch = true) {
    if (this.draft?.id === session.id) {
      if (!session.messages.some((message) => message.role === 'user')) {
        this.draft = structuredClone(session);
        return;
      }
      this.db.exec('BEGIN IMMEDIATE');
      try {
        session.updatedAt = new Date().toISOString();
        this.db
          .prepare('INSERT INTO sessions (id,data) VALUES (?,?)')
          .run(session.id, JSON.stringify(session));
        this.setSetting('currentId', session.id);
        this.db.exec('COMMIT');
        this.draft = null;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      return;
    }
    if (touch) session.updatedAt = new Date().toISOString();
    this.db
      .prepare('INSERT OR REPLACE INTO sessions (id,data) VALUES (?,?)')
      .run(session.id, JSON.stringify(session));
  }
  currentId() {
    return this.draft?.id ?? (this.getSetting('currentId') || null);
  }
  select(id: string) {
    if (!this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(id))
      throw new Error('保存済みのセッションが見つかりません。');
    this.setSetting('currentId', id);
    this.draft = null;
  }
  current(): Session {
    const id = this.currentId();
    if (!id) throw new Error('セッションを作成してください。');
    return this.get(id);
  }
  listCharacters(): Character[] {
    const rows = this.db.prepare('SELECT data FROM characters ORDER BY rowid').all() as {
      data: string;
    }[];
    return rows.map((row) => JSON.parse(row.data) as Character);
  }
  character(id: string): Character {
    const row = this.db.prepare('SELECT data FROM characters WHERE id = ?').get(id) as
      { data: string } | undefined;
    if (!row) throw new Error('キャラクターが見つかりません。');
    return JSON.parse(row.data);
  }
  saveCharacter(character: Character) {
    this.db
      .prepare(
        'INSERT INTO characters (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(character.id, JSON.stringify(character));
  }
  seedCharacters(preset: Character) {
    if (!this.listCharacters().length) this.saveCharacter(preset);
  }
  deleteCharacter(id: string) {
    this.character(id);
    if (this.listCharacters().length <= 1)
      throw new Error('少なくとも1人のキャラクターを残してください。');
    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  }
  characterForNewSession(id?: string): Character {
    if (id) return this.character(id);
    const currentId = this.currentId();
    const current = currentId ? this.get(currentId).character : undefined;
    // Use the latest library settings; a deleted character's session can still be continued.
    return (
      this.listCharacters().find((item) => item.id === current?.id) ??
      current ??
      this.listCharacters()[0]
    );
  }
  create(character: Character): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      title: '新しい会話',
      createdAt: now,
      updatedAt: now,
      character: structuredClone(character),
      messages: [],
    };
    if (character.greeting?.trim())
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        text: '',
        greeting: true,
        segments: splitGreeting(
          expandCharacterText(character.greeting, character),
          character.defaultExpression,
        ),
        status: 'complete',
        createdAt: now,
      });
    this.draft = session;
    return structuredClone(session);
  }
  rename(id: string, title: string) {
    const session = this.get(id);
    if (!title.trim() || title.length > 120)
      throw new Error('名前は1〜120文字で入力してください。');
    session.title = title.trim();
    this.put(session);
  }
  delete(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    if (this.getSetting('currentId') === id) this.setSetting('currentId', this.list()[0]?.id ?? '');
  }
  addUser(text: string) {
    const session = this.current();
    const message: Message = {
      id: randomUUID(),
      role: 'user',
      text,
      segments: [],
      status: 'complete',
      createdAt: new Date().toISOString(),
    };
    if (!session.messages.some((item) => item.role === 'user') && session.title === '新しい会話')
      session.title = text.replace(/\s+/g, ' ').slice(0, 30);
    session.messages.push(message);
    this.put(session);
    return message;
  }
  beginAssistant(): Message {
    const session = this.current();
    const message: Message = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      segments: [],
      status: 'generating',
      createdAt: new Date().toISOString(),
    };
    session.messages.push(message);
    this.put(session);
    return message;
  }
  append(sessionId: string, messageId: string, segment: Segment) {
    const session = this.get(sessionId);
    const message = session.messages.find((item) => item.id === messageId);
    if (!message || message.status !== 'generating')
      throw new Error('生成対象の回答が見つかりません。');
    message.segments.push(segment);
    this.put(session);
  }
  finish(sessionId: string, messageId: string, status: Message['status'], error?: string) {
    const session = this.get(sessionId);
    const message = session.messages.find((item) => item.id === messageId);
    if (!message) throw new Error('回答が見つかりません。');
    message.status = status;
    message.error = error;
    this.put(session);
  }
  edit(messageId: string, text: string) {
    const session = this.current();
    const index = session.messages.findIndex(
      (item) => item.id === messageId && item.role === 'user',
    );
    if (index < 0) throw new Error('編集する発言が見つかりません。');
    session.messages = session.messages.slice(0, index + 1);
    session.messages[index].text = text;
    this.put(session);
  }
  prepareRetry() {
    const session = this.current();
    const index = session.messages.findLastIndex((item) => item.role === 'user');
    if (index < 0) throw new Error('再生成する発言がありません。');
    session.messages = session.messages.slice(0, index + 1);
    this.put(session);
  }
}

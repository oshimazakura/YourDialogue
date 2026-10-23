export type Speech = { type: 'speech'; expression: string; text: string };
export type Phone = {
  type: 'phone';
  format: 'text' | 'markdown' | 'code';
  language?: string;
  text: string;
};
export type Narration = { type: 'narration'; text: string };
export type Segment = Speech | Narration | Phone;
export type MessageStatus = 'generating' | 'complete' | 'interrupted' | 'error';
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  segments: Segment[];
  status: MessageStatus;
  createdAt: string;
  error?: string;
  greeting?: boolean;
}
export interface Character {
  id: string;
  name: string;
  description: string;
  greeting?: string;
  personality?: string;
  scenario?: string;
  exampleMessages?: string;
  background?: string;
  placement?: { scale: number; x: number; y: number };
  importedCard?: { version: 1 | 2; original: Record<string, unknown>; warnings: string[] };
  defaultExpression: string;
  expressions: { id: string; description: string; image: string }[];
}
export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  copiedFrom?: string;
  character: Character;
  messages: Message[];
}
export interface Preferences {
  baseUrl: string;
  model: string;
  characterMs: number;
  fontSize: number;
  sound: boolean;
}
export interface PublicSettings extends Preferences {
  hasApiKey: boolean;
  keyStorage: 'encrypted' | 'memory';
}
export interface AppState {
  characters: Character[];
  sessions: Session[];
  currentId: string | null;
  currentSession: Session | null;
  settings: PublicSettings;
  busy: boolean;
  diagnosticsEnabled?: boolean;
}
export interface SettingsInput extends Preferences {
  apiKey?: string;
}
export interface ModelOption {
  id: string;
  name: string;
}
export interface ModelsInput {
  baseUrl: string;
  apiKey?: string;
}
export interface DialogueApi {
  listModels(input: ModelsInput): Promise<ModelOption[]>;
  reportCharacterDraft(
    input: {
      character: Character;
      dirty: boolean;
      error: string | null;
      selectedExpression: number;
    } | null,
  ): Promise<void>;
  reportUi(input: Record<string, string | number | boolean | null>): Promise<void>;
  getState(): Promise<AppState>;
  createSession(characterId?: string): Promise<AppState>;
  saveCharacter(character: Character): Promise<AppState>;
  deleteCharacter(id: string): Promise<AppState>;
  importCharacter(): Promise<Character | null>;
  pickImage(): Promise<string | null>;
  openSession(id: string): Promise<AppState>;
  renameSession(id: string, title: string): Promise<AppState>;
  deleteSession(id: string): Promise<AppState>;
  send(text: string): Promise<void>;
  edit(messageId: string, text: string): Promise<void>;
  retry(): Promise<void>;
  stop(): Promise<void>;
  saveSettings(input: SettingsInput): Promise<AppState>;
  copyText(text: string): Promise<void>;
  onState(listener: (state: AppState) => void): () => void;
}

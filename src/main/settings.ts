import { safeStorage } from 'electron';
import type { Store } from '../core/store.ts';
import type { PublicSettings, SettingsInput } from '../shared/types.ts';

export class Settings {
  private store: Store;
  private memoryKey = '';
  constructor(store: Store) { this.store = store; }
  private canEncrypt() {
    return safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  }
  public(): PublicSettings {
    return { ...this.store.preferences(), hasApiKey: !!(this.memoryKey || this.store.getSetting('encryptedApiKey')),
      keyStorage: this.canEncrypt() ? 'encrypted' : 'memory' };
  }
  async key(): Promise<string> {
    if (this.memoryKey) return this.memoryKey;
    const saved = this.store.getSetting('encryptedApiKey');
    if (!saved) return '';
    try { return safeStorage.decryptString(Buffer.from(saved, 'base64')); }
    catch { throw new Error('保存したAPIキーを復号できません。CONFIGで再入力してください。'); }
  }
  async save(input: SettingsInput) {
    if (!input || typeof input !== 'object' || typeof input.model !== 'string' || input.model.length > 200 ||
      !Number.isFinite(input.characterMs) || input.characterMs < 0 || input.characterMs > 100 ||
      !Number.isFinite(input.fontSize) || input.fontSize < 16 || input.fontSize > 32 || typeof input.sound !== 'boolean') {
      throw new Error('設定値を確認してください。');
    }
    if (input.apiKey !== undefined) {
      if (typeof input.apiKey !== 'string' || input.apiKey.length > 1000) throw new Error('APIキーを確認してください。');
      const key = input.apiKey.trim();
      if (key && this.canEncrypt()) {
        this.store.setSetting('encryptedApiKey', safeStorage.encryptString(key).toString('base64'));
        this.memoryKey = '';
      } else {
        this.memoryKey = key;
        this.store.setSetting('encryptedApiKey', '');
      }
    }
    this.store.setSetting('preferences', JSON.stringify({ model: input.model.trim(), characterMs: input.characterMs,
      fontSize: input.fontSize, sound: input.sound }));
  }
}

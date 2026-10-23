import { normalizeBaseUrl } from '../shared/connection.ts';
import type { safeStorage } from 'electron';
type KeyStorage = Pick<
  typeof safeStorage,
  'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'
>;
import type { Store } from '../core/store.ts';
import type { PublicSettings, SettingsInput } from '../shared/types.ts';

export class Settings {
  private store: Store;
  private memoryKey = '';
  private secureStorage: KeyStorage;
  constructor(store: Store, secureStorage: KeyStorage) {
    this.store = store;
    this.secureStorage = secureStorage;
  }
  private canEncrypt() {
    return (
      this.secureStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' ||
        this.secureStorage.getSelectedStorageBackend() !== 'basic_text')
    );
  }
  public(): PublicSettings {
    return {
      ...this.store.preferences(),
      hasApiKey: !!(this.memoryKey || this.store.getSetting('encryptedApiKey')),
      keyStorage: this.canEncrypt() ? 'encrypted' : 'memory',
    };
  }
  async key(): Promise<string> {
    if (this.memoryKey) return this.memoryKey;
    const saved = this.store.getSetting('encryptedApiKey');
    if (!saved) return '';
    try {
      return this.secureStorage.decryptString(Buffer.from(saved, 'base64'));
    } catch {
      throw new Error('保存したAPIキーを復号できません。CONFIGで再入力してください。');
    }
  }
  async connectionKey(baseUrl: string, apiKey?: string): Promise<string> {
    const target = normalizeBaseUrl(baseUrl);
    if (apiKey !== undefined) {
      if (typeof apiKey !== 'string' || apiKey.length > 1000)
        throw new Error('APIキーを確認してください。');
      return apiKey.trim();
    }
    // Never send an existing service's saved credential to another base URL.
    return target === normalizeBaseUrl(this.store.preferences().baseUrl) ? this.key() : '';
  }
  async save(input: SettingsInput) {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof input.model !== 'string' ||
      input.model.length > 200 ||
      !Number.isFinite(input.characterMs) ||
      input.characterMs < 0 ||
      input.characterMs > 100 ||
      !Number.isFinite(input.fontSize) ||
      input.fontSize < 16 ||
      input.fontSize > 32 ||
      typeof input.sound !== 'boolean'
    ) {
      throw new Error('設定値を確認してください。');
    }
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const changed = baseUrl !== normalizeBaseUrl(this.store.preferences().baseUrl);
    if (changed && input.apiKey === undefined) input = { ...input, apiKey: '' };
    if (input.apiKey !== undefined) {
      if (typeof input.apiKey !== 'string' || input.apiKey.length > 1000)
        throw new Error('APIキーを確認してください。');
      const key = input.apiKey.trim();
      if (key && this.canEncrypt()) {
        this.store.setSetting(
          'encryptedApiKey',
          this.secureStorage.encryptString(key).toString('base64'),
        );
        this.memoryKey = '';
      } else {
        this.memoryKey = key;
        this.store.setSetting('encryptedApiKey', '');
      }
    }
    this.store.setSetting(
      'preferences',
      JSON.stringify({
        baseUrl,
        model: input.model.trim(),
        characterMs: input.characterMs,
        fontSize: input.fontSize,
        sound: input.sound,
      }),
    );
  }
}

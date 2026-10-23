import test from 'node:test';
import assert from 'node:assert/strict';
import { Settings } from '../src/main/settings.ts';
import { Store } from '../src/core/store.ts';
import { DEFAULT_BASE_URL } from '../src/shared/connection.ts';

const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret' as const,
  encryptString: (text: string) => Buffer.from('encrypted:' + text),
  decryptString: (bytes: Buffer) => bytes.toString().replace(/^encrypted:/, ''),
};
const input = {
  baseUrl: DEFAULT_BASE_URL,
  model: 'test/model',
  characterMs: 28,
  fontSize: 21,
  sound: true,
};

test('existing settings default to OpenRouter and keep their saved encrypted API key', async () => {
  const store = new Store(':memory:');
  try {
    store.setSetting('preferences', JSON.stringify({ model: 'existing/model' }));
    store.setSetting('encryptedApiKey', storage.encryptString('existing-key').toString('base64'));
    const settings = new Settings(store, storage);
    assert.equal(settings.public().baseUrl, DEFAULT_BASE_URL);
    assert.equal(settings.public().model, 'existing/model');
    assert.equal(await settings.connectionKey(DEFAULT_BASE_URL + '/'), 'existing-key');
    await settings.save({ ...input, characterMs: 30 });
    assert.equal(await settings.key(), 'existing-key');
    assert.equal(await settings.connectionKey('http://localhost:1234/v1'), '');
    assert.equal(await settings.connectionKey('http://localhost:1234/v1', 'new-key'), 'new-key');
    assert.equal(await settings.connectionKey(DEFAULT_BASE_URL, ''), '');
  } finally {
    store.close();
  }
});

test('changing endpoints clears old credentials while saving an explicit new key scopes it to the new connection', async () => {
  const store = new Store(':memory:');
  try {
    const settings = new Settings(store, storage);
    await settings.save({ ...input, apiKey: 'old-key' });
    const baseUrl = 'http://localhost:1234/v1';
    await settings.save({ ...input, baseUrl: baseUrl + '/' });
    assert.equal(settings.public().baseUrl, baseUrl);
    assert.equal(await settings.key(), '');
    await settings.save({ ...input, baseUrl, apiKey: 'new-key' });
    assert.equal(await settings.connectionKey(baseUrl), 'new-key');
    assert.equal(await settings.connectionKey(DEFAULT_BASE_URL), '');
    assert.equal(new Settings(store, storage).public().baseUrl, baseUrl);
    await assert.rejects(() => settings.save({ ...input, baseUrl: 'invalid', apiKey: 'bad' }));
    assert.equal(await settings.key(), 'new-key');
    const memory = new Settings(store, { ...storage, isEncryptionAvailable: () => false });
    await memory.save({ ...input, baseUrl, apiKey: 'temporary-key' });
    assert.equal(await memory.key(), 'temporary-key');
    assert.equal(await memory.connectionKey(DEFAULT_BASE_URL), '');
    await memory.save(input);
    assert.equal(await memory.key(), '');
  } finally {
    store.close();
  }
});

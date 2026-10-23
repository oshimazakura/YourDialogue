import { app, BrowserWindow, clipboard, ipcMain, Menu, protocol } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describeCharacter } from '../core/character-diagnostics.ts';
import { AssetStore } from '../core/assets.ts';
import { Characters, installAssetProtocol } from './characters.ts';
import { Store } from '../core/store.ts';
import { DialogueService } from '../core/service.ts';
import { Settings } from './settings.ts';
import { defaultCharacter } from '../shared/character.ts';
import { Diagnostics } from '../core/diagnostics.ts';
import { startDebugServer } from './debug-server.ts';
import type { SettingsInput } from '../shared/types.ts';

app.setName('YourDialogue');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'dialogue-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
let window: BrowserWindow | null = null;
let store: Store;
let settings: Settings;
let service: DialogueService;
let characters: Characters;
let quitting = false;
let debugTimer: ReturnType<typeof setInterval> | undefined;
let diagnostics: Diagnostics | undefined;
let debugServer: Awaited<ReturnType<typeof startDebugServer>> | undefined;
const root = join(__dirname, '../renderer/index.html');
const developmentUrl =
  !app.isPackaged && process.env.VITE_DEV_SERVER_URL === 'http://127.0.0.1:5173'
    ? process.env.VITE_DEV_SERVER_URL
    : undefined;
const trustedUrl = developmentUrl ?? pathToFileURL(root).href;

function state() {
  return { ...service.state(settings.public()), diagnosticsEnabled: !!diagnostics };
}
function debugCharacters(content = false) {
  const id = store.currentId();
  return {
    contentIncluded: content,
    library: store.listCharacters().map((character) => describeCharacter(character, content)),
    currentSession: id
      ? { id, character: describeCharacter(store.get(id).character, content) }
      : null,
    editor: diagnostics?.characterEditor(content) ?? null,
  };
}
function persistDebugState() {
  diagnostics?.persistState(debugState());
  diagnostics?.persistCharacters(debugCharacters(true));
}
function debugState() {
  const currentId = store.currentId();
  const session = currentId ? store.get(currentId) : null;
  const last = session?.messages.at(-1);
  const generation = service.diagnosticState();
  const renderer = diagnostics?.renderer();
  const dialogue = renderer?.dialogue as Record<string, unknown> | undefined;
  const appUi = renderer?.app as Record<string, unknown> | undefined;
  const uiMatches =
    appUi?.sessionId === currentId &&
    dialogue?.messageId === session?.messages.findLast((item) => item.role === 'assistant')?.id;
  const summary = generation.busy
    ? generation.phase === 'preparing_connection'
      ? 'preparing_connection'
      : !generation.progress?.chunks
        ? 'waiting_for_first_content'
        : generation.progress.parser.pendingCharacters
          ? 'waiting_for_jsonl_line'
          : 'receiving'
    : last?.status === 'error'
      ? 'generation_error'
      : uiMatches && dialogue?.phase
        ? dialogue.phase
        : 'idle_or_renderer_unavailable';
  return {
    summary,
    generation,
    currentSession: session && {
      id: session.id,
      character: describeCharacter(session.character),
      persisted: store.list().some((item) => item.id === session.id),
      messages: session.messages.length,
      updatedAt: session.updatedAt,
      lastMessage: last && {
        id: last.id,
        role: last.role,
        status: last.status,
        segments: last.segments.length,
        error: last.error,
      },
    },
    sessionCount: store.list().length,
    characterEditor: diagnostics?.characterEditor() ?? null,
  };
}
function emit() {
  if (window && !window.isDestroyed()) window.webContents.send('dialogue:changed', state());
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('入力形式が正しくありません。');
  return value;
}
function register() {
  const handle = (name: string, run: (...args: unknown[]) => unknown) => {
    ipcMain.handle(`dialogue:${name}`, (event, ...args: unknown[]) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url !== trustedUrl + (developmentUrl ? '/' : '')
      ) {
        throw new Error('許可されていない操作です。');
      }
      try {
        const result = run(...args);
        return Promise.resolve(result).catch((error: unknown) => {
          diagnostics?.record(
            'ipc.failed',
            { operation: name, error: error instanceof Error ? error.message : 'unknown' },
            'error',
          );
          throw error;
        });
      } catch (error) {
        diagnostics?.record(
          'ipc.failed',
          { operation: name, error: error instanceof Error ? error.message : 'unknown' },
          'error',
        );
        throw error;
      }
    });
  };
  handle('diagnostic-ui', (input) => {
    diagnostics?.updateUi(input);
  });
  handle('diagnostic-character', (input) => {
    diagnostics?.updateCharacterDraft(input);
  });
  handle('state', state);
  handle('create', async (id) => {
    await service.create(store.characterForNewSession(id === undefined ? undefined : string(id)));
    return state();
  });
  handle('character-save', (input) => {
    const character = characters.save(input);
    diagnostics?.record('character.saved', {
      characterId: character.id,
      character: describeCharacter(character),
    });
    emit();
    return state();
  });
  handle('character-delete', (id) => {
    store.deleteCharacter(string(id));
    emit();
    return state();
  });
  handle('character-import', () => {
    if (!window) throw new Error('ウィンドウがありません。');
    return characters.importCard(window).then((character) => {
      if (character)
        diagnostics?.record('character.imported', {
          characterId: character.id,
          character: describeCharacter(character),
        });
      return character;
    });
  });
  handle('image-pick', () => {
    if (!window) throw new Error('ウィンドウがありません。');
    return characters.pickImage(window);
  });
  handle('open-session', async (id) => {
    await service.open(string(id));
    return state();
  });
  handle('rename', (id, title) => {
    store.rename(string(id), string(title));
    emit();
    return state();
  });
  handle('delete', async (id) => {
    const target = string(id);
    store.get(target);
    await service.stop();
    store.delete(target);
    if (!store.currentId()) await service.create(store.characterForNewSession());
    emit();
    return state();
  });
  handle('send', (text) => service.send(string(text)));
  handle('edit', async (id, text) => {
    await service.stop();
    await service.send(string(text), string(id));
  });
  handle('retry', async () => {
    await service.stop();
    await service.send('', undefined, true);
  });
  handle('stop', () => service.stop());
  handle('settings', async (input) => {
    await settings.save(input as SettingsInput);
    emit();
    return state();
  });
  handle('clipboard', (text) => {
    const value = string(text);
    if (value.length > 4_000_000) throw new Error('コピーする内容が長すぎます。');
    clipboard.writeText(value);
  });
}
function openWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 850,
    minHeight: 680,
    backgroundColor: '#151b28',
    title: 'YourDialogue',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => {
    diagnostics?.record(
      'renderer.gone',
      { reason: details.reason, exitCode: details.exitCode },
      'error',
    );
    diagnostics?.clearUi();
    void service.stop();
  });
  window.webContents.on('unresponsive', () =>
    diagnostics?.record('renderer.unresponsive', {}, 'error'),
  );
  window.webContents.on('did-fail-load', (_event, code, description) =>
    diagnostics?.record('renderer.load_failed', { code, description }, 'error'),
  );
  window.webContents.on('did-start-loading', () => {
    diagnostics?.clearUi();
    diagnostics?.record('renderer.loading');
  });
  window.on('closed', () => {
    diagnostics?.clearUi();
    window = null;
    void service.stop();
  });
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(root);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  void app
    .whenReady()
    .then(async () => {
      const directory = app.getPath('userData');
      mkdirSync(directory, { recursive: true });
      store = new Store(join(directory, 'dialogue.sqlite'));
      store.seedCharacters(defaultCharacter);
      if (!store.currentId()) store.create(store.characterForNewSession());
      const assets = new AssetStore(join(directory, 'assets'));
      installAssetProtocol(assets);
      characters = new Characters(store, assets);
      settings = new Settings(store);
      if (!app.isPackaged) {
        try {
          diagnostics = new Diagnostics(
            join(app.getAppPath(), '.your-dialogue-debug'),
            process.env.YOUR_DIALOGUE_DEBUG_CONTENT !== '0',
          );
        } catch {
          console.error('診断ログの初期化に失敗しました。');
        }
      }
      service = new DialogueService(store, () => settings.key(), emit, undefined, diagnostics);
      if (diagnostics) {
        try {
          debugServer = await startDebugServer({
            directory: join(app.getAppPath(), '.your-dialogue-debug'),
            diagnostics,
            state: debugState,
            characters: debugCharacters,
            screenshot: async () => {
              if (!window || window.isDestroyed()) throw new Error('Window unavailable');
              return (await window.webContents.capturePage()).toPNG();
            },
          });
          console.log(
            `診断API: ${debugServer.url}（接続情報: .your-dialogue-debug/connection.json）`,
          );
        } catch {
          diagnostics.record('debug.start_failed', {}, 'error');
        }
        persistDebugState();
        debugTimer = setInterval(persistDebugState, 1000);
        debugTimer.unref();
      }
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin'
            ? [
                {
                  label: app.name,
                  submenu: [{ role: 'about' as const }, { role: 'quit' as const }],
                },
              ]
            : []),
          {
            label: 'Edit',
            submenu: [
              { role: 'undo' },
              { role: 'redo' },
              { type: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              { role: 'selectAll' },
            ],
          },
          {
            label: 'View',
            submenu: [
              { role: 'togglefullscreen' },
              ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
            ],
          },
        ]),
      );
      register();
      openWindow();
      app.on('activate', () => {
        if (!window) openWindow();
      });
    })
    .catch((error) => {
      console.error('起動に失敗しました:', error instanceof Error ? error.message : 'unknown');
      app.quit();
    });
  app.on('before-quit', (event) => {
    if (!service || quitting) return;
    event.preventDefault();
    quitting = true;
    clearInterval(debugTimer);
    void service.stop().finally(async () => {
      persistDebugState();
      await debugServer?.close();
      store.close();
      app.quit();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

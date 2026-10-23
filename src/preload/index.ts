import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, DialogueApi, SettingsInput } from '../shared/types.ts';

const api: DialogueApi = {
  reportCharacterDraft: (input) => ipcRenderer.invoke('dialogue:diagnostic-character', input),
  reportUi: (input) => ipcRenderer.invoke('dialogue:diagnostic-ui', input),
  getState: () => ipcRenderer.invoke('dialogue:state'),
  createSession: (id) => ipcRenderer.invoke('dialogue:create', id),
  saveCharacter: (character) => ipcRenderer.invoke('dialogue:character-save', character),
  deleteCharacter: (id) => ipcRenderer.invoke('dialogue:character-delete', id),
  importCharacter: () => ipcRenderer.invoke('dialogue:character-import'),
  pickImage: () => ipcRenderer.invoke('dialogue:image-pick'),
  openSession: (id: string) => ipcRenderer.invoke('dialogue:open-session', id),
  renameSession: (id: string, title: string) => ipcRenderer.invoke('dialogue:rename', id, title),
  deleteSession: (id: string) => ipcRenderer.invoke('dialogue:delete', id),
  send: (text: string) => ipcRenderer.invoke('dialogue:send', text),
  edit: (id: string, text: string) => ipcRenderer.invoke('dialogue:edit', id, text),
  retry: () => ipcRenderer.invoke('dialogue:retry'),
  stop: () => ipcRenderer.invoke('dialogue:stop'),
  saveSettings: (input: SettingsInput) => ipcRenderer.invoke('dialogue:settings', input),
  copyText: (text: string) => ipcRenderer.invoke('dialogue:clipboard', text),
  onState: (listener: (state: AppState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppState) => listener(state);
    ipcRenderer.on('dialogue:changed', handler);
    return () => ipcRenderer.removeListener('dialogue:changed', handler);
  },
};
contextBridge.exposeInMainWorld('dialogue', api);
